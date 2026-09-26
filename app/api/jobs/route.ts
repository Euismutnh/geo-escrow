import { after } from 'next/server';
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { listJobs } from '@/lib/jobs-repo';
import { isMarketFilter, MARKET_FILTERS, type MarketFilter } from '@/lib/status';
import { parseAddress, parseIntParam, requireAddress } from '@/lib/validate';
import {
  LIMITS,
  requireText,
  optionalText,
  requireWei,
  requireJobId,
  requireFutureDate,
  requireQueryPool,
} from '@/lib/validate-input';
import { queryPoolHash } from '@/lib/hash';
import { readJobFromChain } from '@/lib/chain-server';
import { runBaseline } from '@/lib/oracle/runner';
import { enginesFor } from '@/lib/oracle';
import { rateLimit } from '@/lib/rate-limit';
import { ok, fail, handler, internalError } from '@/lib/http';

// POST memicu baseline lewat after(), yang tetap dihitung ke maxDuration.
export const maxDuration = 60;

/**
 * GET /api/jobs
 *   ?filter=all|open|progress|dispute|done
 *   ?wallet=0x...   (client ATAU freelancer)
 *   ?page=1&limit=20
 */
export const GET = handler(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;

  const rawFilter = p.get('filter');
  let filter: MarketFilter | undefined;
  if (rawFilter) {
    if (!isMarketFilter(rawFilter)) {
      return fail(
        'VALIDATION',
        `filter tidak dikenal. Pilihan: ${Object.keys(MARKET_FILTERS).join(', ')}`
      );
    }
    filter = rawFilter;
  }

  const result = await listJobs({
    filter,
    wallet: parseAddress(p.get('wallet')),
    page: parseIntParam(p.get('page'), { def: 1, min: 1, max: 10_000 }),
    limit: parseIntParam(p.get('limit'), { def: 20, min: 1, max: 50 }),
  });

  return ok(result);
});

/**
 * POST /api/jobs — dipanggil FE SETELAH transaksi createJob() sukses.
 *
 * GERBANG KEASLIAN: backend menghitung ulang queryPoolHash dari body,
 * lalu membandingkannya dengan yang sudah terkunci di blockchain. Data
 * palsu ditolak oleh matematika, bukan oleh daftar izin -- penyerang
 * tidak bisa mengubah yang di on-chain tanpa membayar budget dari
 * wallet-nya sendiri.
 *
 * PERINGATAN: gerbang itu MATI saat CHAIN_ENABLED=false. Dalam mode itu
 * endpoint ini menerima job apa pun DAN memicu baseline (= panggilan AI
 * berbayar). Karena itu ada dua penahan di bawah: penolakan mutlak di
 * produksi, dan rate limit di pengembangan.
 */
export const POST = handler(async (req: NextRequest) => {
  // ---------- interlock keamanan ----------
  // Produksi tanpa verifikasi on-chain = endpoint publik yang bisa
  // disuruh siapa saja menghabiskan kredit AI, tanpa batas dan tanpa
  // biaya bagi penyerang. Tolak mentah-mentah, jangan diserahkan ke
  // kehati-hatian orang yang men-deploy.
  if (env.isProduction && !env.chainEnabled) {
    return fail(
      'WRONG_STATUS',
      'CHAIN_ENABLED harus true di produksi — tanpa itu verifikasi on-chain mati'
    );
  }

  // Penahan kedua: tiap job yang dibuat memicu baseline, jadi laju
  // pembuatan job = laju pengeluaran AI. Dua lapis, sengaja.
  //
  // Lapis global dibuat LONGGAR (500ms). Kalau dipasang ketat, dua orang
  // yang membuat job bersamaan saat demo akan saling menjegal -- padahal
  // keduanya sah.
  if (!rateLimit('jobs:create:global', 500)) {
    return fail('RATE_LIMITED', 'Server sedang sibuk, coba lagi sebentar');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('VALIDATION', 'Body harus JSON yang valid');
  }
  if (typeof body !== 'object' || body === null) {
    return fail('VALIDATION', 'Body harus berupa objek JSON');
  }

  const b = body as Record<string, unknown>;

  // ---------- validasi (semua melempar ApiError -> 400) ----------
  const jobId = requireJobId(b.jobId);
  const clientAddr = requireAddress(b.clientAddr, 'clientAddr');
  const brand = requireText(b.brand, 'Nama brand', LIMITS.brand);
  const brief = optionalText(b.brief, 'Brief', LIMITS.brief);
  const { queries, targetCount } = requireQueryPool(b.queries, b.targetCount);
  const budgetWei = requireWei(b.budgetWei, 'budgetWei');
  const acceptDeadline = requireFutureDate(b.acceptDeadline, 'acceptDeadline');
  const multiEngine = b.multiEngine === true;

  // Lapis per-alamat dibuat KETAT (5 detik), dan baru bisa dipasang di
  // sini karena butuh clientAddr yang sudah tervalidasi. Satu wallet yang
  // menembak berulang kali tertahan, tanpa mengganggu wallet lain.
  if (!rateLimit(`jobs:create:${clientAddr}`, 5_000)) {
    return fail('RATE_LIMITED', 'Tunggu beberapa detik sebelum membuat job lagi');
  }

  // Gagalkan SEKARANG kalau provider aktif tidak sanggup multi-engine,
  // bukan nanti diam-diam di baseline latar belakang. Tanpa ini, job
  // terlanjur dibuat lalu baseline-nya gagal tanpa user tahu kenapa.
  if (multiEngine) {
    enginesFor(true); // melempar OracleError kalau provider cuma 1 engine
  }

  // ---------- gerbang hash ----------
  const computed = queryPoolHash({ brand, queries, targetCount, multiEngine });

  const onChain = await readJobFromChain(BigInt(jobId));
  if (env.chainEnabled) {
    if (!onChain) {
      return fail('VALIDATION', 'Job belum ada di blockchain — kirim transaksi dulu');
    }
    if (onChain.queryPoolHash.toLowerCase() !== computed.toLowerCase()) {
      return fail('HASH_MISMATCH', 'Data tidak cocok dengan yang terkunci di blockchain');
    }
    if (onChain.client.toLowerCase() !== clientAddr) {
      return fail('HASH_MISMATCH', 'Alamat client tidak cocok dengan on-chain');
    }
  }

  // ---------- simpan ----------
  // budget_wei & status di sini adalah nilai AWAL saat job dibuat.
  // Setelah ini, hanya indexer yang berwenang mengubahnya (§2.1).
  //
  // Saat chain menyala, budget & batas ambil diambil dari KONTRAK, bukan
  // dari body (temuan audit S-20): nilai on-chain sudah dibaca di atas, dan
  // body bisa berbeda — mis. klien yang salah hitung, atau permintaan yang
  // dirangkai tangan. Body tetap divalidasi, jadi bentuk endpoint sama.
  const budgetSaved = env.chainEnabled && onChain ? String(onChain.budget) : budgetWei;
  const deadlineSaved = env.chainEnabled && onChain
    ? new Date(Number(onChain.acceptDeadline) * 1000).toISOString()
    : acceptDeadline;
  const { error } = await db().from('jobs').insert({
    job_id: jobId,
    client_addr: clientAddr,
    brand,
    brief,
    queries,
    target_count: targetCount,
    multi_engine: multiEngine,
    query_pool_hash: computed,
    budget_wei: budgetSaved,
    accept_deadline: deadlineSaved,
    status: 'Open',
    job_state: 'queued_baseline',
  });

  if (error) {
    // 23505 = pelanggaran unique constraint (job_id sudah ada).
    if (error.code === '23505') {
      return fail('VALIDATION', `Job ${jobId} sudah terdaftar`);
    }
    throw internalError('menyimpan job', error);
  }

  // ---------- baseline berjalan SETELAH respons terkirim ----------
  // after() adalah cara resmi Next.js 16 untuk kerja pasca-response.
  // Kalau baseline ditunggu, user melihat form loading 15-20 detik.
  //
  // Batasnya: after() tetap di dalam invocation yang sama, jadi tunduk
  // pada maxDuration. Kalau terpotong, sifat resumable Fase 5 yang
  // menyelamatkan -- panggilan yang sudah selesai tidak terbuang, dan
  // job tertinggal di 'queued_baseline' akan dipungut reclaimStaleLocks().
  after(async () => {
    try {
      await runBaseline(jobId);
    } catch (e) {
      // runBaseline sudah menyetel job_state='error' + last_error,
      // jadi UI tetap bisa menampilkan tombol coba-lagi.
      console.error(`[baseline] job ${jobId} gagal:`, e);
    }
  });

  return ok({ jobId, queryPoolHash: computed, chainVerified: env.chainEnabled });
});
