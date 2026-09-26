import { env } from '@/lib/env';
import { getJob } from '@/lib/jobs-repo';
import { verdictHash, canonicalVerdict, recomputeSubset, type Verdict } from '@/lib/verdict';
import { decide } from '@/lib/scoring';
import { readJobFromChain } from '@/lib/chain-server';
import { parseJobId } from '@/lib/validate';
import { ok, fail, handler } from '@/lib/http';

/**
 * GET /api/jobs/:id/verdict — endpoint audit.
 *
 * Inilah yang membuat klaim "hasilnya diukur, bukan diklaim" bisa
 * dibuktikan, bukan sekadar diucapkan. Tiga hal diperiksa ulang di sini,
 * dan ketiganya bisa diulangi sendiri oleh siapa pun:
 *
 *   1. SUBSET  — diturunkan ulang dari seed. Kalau Oracle mengulang
 *                undian sampai dapat pertanyaan yang menguntungkan,
 *                subset hasil hitungan ulang tidak akan cocok.
 *   2. KEPUTUSAN — dihitung ulang dengan aritmetika integer dari skor
 *                yang dipublikasi. Kalau angkanya dipelintir, tidak cocok.
 *   3. HASH    — dihitung ulang dari verdict, lalu dibandingkan dengan
 *                yang tersimpan on-chain. Kalau Oracle mempublikasi
 *                verdict berbeda dari yang dikirim ke blockchain, ketahuan.
 */
export const GET = handler(async (
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const jobId = parseJobId(id);

  const job = await getJob(jobId);
  if (!job.verdict_json) {
    return fail('NOT_FOUND', 'Job ini belum diverifikasi');
  }

  const verdict = job.verdict_json as Verdict;

  // ---- 1. Subset bisa diturunkan ulang dari seed? ----
  // GEOv1: dari seed on-chain. GEOv2: dari seed efektif (seed + hash blok
  // konfirmasi + jobId + hash konten) — lib/verdict.ts recomputeSubset.
  let subsetMatches = false;
  let recomputedSubset: number[] = [];
  try {
    recomputedSubset = recomputeSubset(verdict);
    subsetMatches =
      JSON.stringify(recomputedSubset) === JSON.stringify(verdict.subset);
  } catch {
    subsetMatches = false;
  }

  // ---- 2. Keputusan bisa dihitung ulang dari skor? ----
  let decisionMatches = false;
  try {
    decisionMatches =
      decide({
        score: verdict.score,
        of: verdict.of,
        target: verdict.target,
        n: verdict.n,
      }) === verdict.decision;
  } catch {
    decisionMatches = false;
  }

  // ---- 3. Hash cocok dengan yang di blockchain? ----
  const recomputedHash = verdictHash(verdict);
  const onChainHash = await onChainVerdictHash(jobId);

  const hashMatchesStored =
    !!job.verdict_hash &&
    recomputedHash.toLowerCase() === job.verdict_hash.toLowerCase();

  const hashMatchesChain =
    !!onChainHash && recomputedHash.toLowerCase() === onChainHash.toLowerCase();

  return ok({
    verdict,

    // String kanonik disertakan supaya pihak luar bisa menghitung
    // keccak256-nya sendiri tanpa menebak-nebak format kami.
    canonical: canonicalVerdict(verdict),

    audit: {
      subsetMatches,
      recomputedSubset,
      decisionMatches,
      hashMatchesStored,
      hashMatchesChain,
      // Semua pemeriksaan yang MUNGKIN dilakukan sudah lolos.
      // hashMatchesChain sengaja tidak ikut saat chain mati -- kalau
      // diikutkan, hasilnya selalu false dan kehilangan arti.
      allChecksPassed:
        subsetMatches &&
        decisionMatches &&
        hashMatchesStored &&
        (env.chainEnabled ? hashMatchesChain : true),
    },

    hashes: {
      recomputed: recomputedHash,
      stored: job.verdict_hash,
      onChain: onChainHash,
    },

    // Tanpa penanda ini, verdict hasil pengembangan bisa disangka hasil
    // sungguhan: seed-nya deterministik dan tidak ada transaksi apa pun.
    chainEnabled: env.chainEnabled,
  });
});

/**
 * Hash verdict on-chain, di-cache per proses (temuan audit S-23).
 *
 * Endpoint ini publik dan dulu membaca RPC (2 panggilan) di SETIAP
 * permintaan — cara murah membanjiri RPC. Hash verdict yang sudah terisi
 * TIDAK PERNAH berubah di kontrak (settle/raiseDispute menulisnya sekali;
 * arbiterDecide memakai nilai yang sama), jadi aman disimpan selamanya.
 * Hash nol (belum settle) disimpan sebentar saja.
 */
const verdictHashCache = new Map<number, { hash: string | null; until: number }>();
const EMPTY_TTL_MS = 15_000;
const CACHE_MAX = 500;

async function onChainVerdictHash(jobId: number): Promise<string | null> {
  const hit = verdictHashCache.get(jobId);
  if (hit && hit.until > Date.now()) return hit.hash;

  const onChain = await readJobFromChain(BigInt(jobId));
  const hash = onChain?.verdictHash ?? null;
  const filled = !!hash && !/^0x0*$/.test(hash);
  if (verdictHashCache.size >= CACHE_MAX) verdictHashCache.clear();
  verdictHashCache.set(jobId, { hash, until: filled ? Number.POSITIVE_INFINITY : Date.now() + EMPTY_TTL_MS });
  return hash;
}
