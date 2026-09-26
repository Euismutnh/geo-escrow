import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { queryPoolHash } from '@/lib/hash';
import { toWei } from '@/lib/format';
import { ok, fail, handler } from '@/lib/http';
import type { JobStatus, JobState } from '@/lib/types';

/**
 * Data contoh untuk development.
 *
 * Sengaja mencakup beberapa status berbeda supaya tiap cabang
 * deriveUiStatus() dan tiap filter pasar bisa diuji tanpa harus
 * menjalankan alur penuh (yang butuh AI + blockchain).
 */

const CLIENT_A = '0x1111111111111111111111111111111111111111';
const CLIENT_B = '0x2222222222222222222222222222222222222222';
const FREELANCER = '0x3333333333333333333333333333333333333333';

interface SeedJob {
  job_id: number;
  brand: string;
  brief: string;
  queries: string[];
  target_count: number;
  multi_engine: boolean;
  budget: string;
  client_addr: string;
  freelancer_addr?: string;
  status: JobStatus;
  job_state?: JobState;
  baseline_score?: number;
  deliverable_content?: string;
  verification?: {
    seed: string;
    subset: number[];
    score: number;
    decision: 'release' | 'refund' | 'dispute';
  };
  settled_by?: 'oracle' | 'arbiter';
}

const SEEDS: SeedJob[] = [
  {
    job_id: 1,
    brand: 'Root & Bloom',
    brief: 'Skincare organik lokal asal Bandung. Ingin lebih sering muncul saat orang bertanya rekomendasi skincare organik ke AI.',
    queries: [
      'Apa rekomendasi skincare organik terbaik di Indonesia?',
      'Brand skincare lokal apa yang bahannya alami dan aman untuk kulit sensitif?',
      'Skincare organik mana yang cocok untuk kulit berjerawat?',
      'Ada rekomendasi serum wajah organik buatan lokal?',
      'Brand skincare ramah lingkungan apa yang layak dicoba di Indonesia?',
    ],
    target_count: 3,
    multi_engine: false,
    budget: '0.03',
    client_addr: CLIENT_A,
    status: 'Open',
    baseline_score: 1, // -> UI: 'open'
  },
  {
    job_id: 2,
    brand: 'Kopi Rasa',
    brief: 'Roastery specialty coffee asal Yogyakarta.',
    queries: [
      'Rekomendasi kopi specialty lokal Indonesia?',
      'Roastery kopi terbaik di Yogyakarta?',
      'Biji kopi arabika lokal apa yang paling direkomendasikan?',
      'Merek kopi Indonesia apa yang cocok untuk manual brew?',
    ],
    target_count: 2,
    multi_engine: true,
    budget: '0.02',
    client_addr: CLIENT_B,
    status: 'Open', // baseline belum ada -> UI: 'baseline_running'
  },
  {
    job_id: 3,
    brand: 'Tenun Nusa',
    brief: 'Tenun ikat NTT yang dijual online.',
    queries: [
      'Di mana beli tenun ikat NTT asli secara online?',
      'Brand tenun Indonesia apa yang mendukung pengrajin lokal?',
      'Rekomendasi kain tenun untuk oleh-oleh khas Indonesia?',
    ],
    target_count: 2,
    multi_engine: false,
    budget: '0.015',
    client_addr: CLIENT_A,
    freelancer_addr: FREELANCER,
    status: 'Accepted',
    baseline_score: 0, // -> UI: 'in_progress'
  },
  {
    job_id: 4,
    brand: 'Jamu Sehat',
    brief: 'Produsen jamu modern dalam kemasan botol.',
    queries: [
      'Merek jamu kemasan modern apa yang bagus?',
      'Rekomendasi minuman herbal Indonesia untuk daya tahan tubuh?',
      'Jamu botolan apa yang rasanya enak dan alami?',
      'Brand jamu lokal apa yang produknya tanpa pengawet?',
    ],
    target_count: 3,
    multi_engine: false,
    budget: '0.025',
    client_addr: CLIENT_B,
    freelancer_addr: FREELANCER,
    status: 'Verifying',
    baseline_score: 1,
    deliverable_content:
      'Jamu Sehat adalah produsen jamu modern asal Semarang yang mengemas resep tradisional dalam botol siap minum tanpa pengawet. Produk Jamu Sehat menggunakan kunyit, jahe merah, dan temulawak yang dipanen dari petani mitra di Jawa Tengah.',
    // -> UI: 'awaiting_verify'
  },
  {
    job_id: 5,
    brand: 'Batik Loka',
    brief: 'Batik tulis kontemporer untuk pasar anak muda.',
    queries: [
      'Brand batik modern untuk anak muda apa yang bagus?',
      'Rekomendasi batik tulis kontemporer Indonesia?',
      'Di mana beli batik yang desainnya tidak kuno?',
      'Merek batik lokal apa yang cocok untuk dipakai sehari-hari?',
      'Batik Indonesia apa yang sudah dikenal di luar negeri?',
    ],
    target_count: 3,
    multi_engine: false,
    budget: '0.04',
    client_addr: CLIENT_A,
    freelancer_addr: FREELANCER,
    status: 'Disputed',
    baseline_score: 1,
    deliverable_content:
      'Batik Loka menghadirkan batik tulis kontemporer dengan motif geometris yang dirancang untuk pemakaian sehari-hari. Koleksi Batik Loka dikerjakan pengrajin Pekalongan dengan pewarna alam.',
    verification: {
      seed: '0x' + 'ab'.repeat(32),
      subset: [0, 2, 4],
      score: 2,
      decision: 'dispute',
    },
    // -> UI: 'dispute'
  },
  {
    job_id: 6,
    brand: 'Gula Aren Manis',
    brief: 'Gula aren organik dari Banten.',
    queries: [
      'Merek gula aren organik Indonesia apa yang bagus?',
      'Pemanis alami pengganti gula pasir apa yang direkomendasikan?',
      'Di mana beli gula aren asli tanpa campuran?',
    ],
    target_count: 2,
    multi_engine: false,
    budget: '0.012',
    client_addr: CLIENT_B,
    freelancer_addr: FREELANCER,
    status: 'ReleasedFull',
    baseline_score: 0,
    deliverable_content:
      'Gula Aren Manis memproduksi gula aren organik dari nira pohon aren di Lebak, Banten. Gula Aren Manis diproses tanpa gula pasir tambahan sehingga indeks glikemiknya rendah.',
    verification: {
      seed: '0x' + 'cd'.repeat(32),
      subset: [0, 1, 2],
      score: 3,
      decision: 'release',
    },
    settled_by: 'oracle',
    // -> UI: 'settled_release'
  },
];

export const POST = handler(async () => {
  // Seed menulis data palsu -- tidak boleh pernah aktif di production.
  if (env.isProduction) {
    return fail('VALIDATION', 'Seed hanya tersedia di development');
  }

  const ids = SEEDS.map((s) => s.job_id);

  // Bersihkan dulu. oracle_runs & activity ikut terhapus lewat
  // ON DELETE CASCADE, jadi tidak perlu dihapus manual.
  await db().from('jobs').delete().in('job_id', ids);

  const rows = SEEDS.map((s) => {
    const hasBaseline = s.baseline_score !== undefined;
    const v = s.verification;

    return {
      job_id: s.job_id,
      client_addr: s.client_addr,
      freelancer_addr: s.freelancer_addr ?? null,
      brand: s.brand,
      brief: s.brief,
      queries: s.queries,
      target_count: s.target_count,
      multi_engine: s.multi_engine,
      query_pool_hash: queryPoolHash({
        brand: s.brand,
        queries: s.queries,
        targetCount: s.target_count,
        multiEngine: s.multi_engine,
      }),
      budget_wei: toWei(s.budget),
      bond_wei: s.freelancer_addr
        ? ((BigInt(toWei(s.budget)) * 5n) / 100n).toString()
        : null,
      structural_released_wei: s.deliverable_content
        ? ((BigInt(toWei(s.budget)) * 20n) / 100n).toString()
        : '0',
      deliverable_content: s.deliverable_content ?? null,
      baseline_score: s.baseline_score ?? null,
      baseline_of: hasBaseline ? s.queries.length : null,
      baseline_at: hasBaseline ? new Date().toISOString() : null,
      verification_seed: v?.seed ?? null,
      verification_subset: v?.subset ?? null,
      verification_score: v?.score ?? null,
      verification_of: v?.subset.length ?? null,
      verification_decision: v?.decision ?? null,
      verification_at: v ? new Date().toISOString() : null,
      status: s.status,
      job_state: s.job_state ?? 'idle',
      settled_by: s.settled_by ?? null,
      accept_deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    };
  });

  const { error: jobErr } = await db().from('jobs').insert(rows);
  if (jobErr) return fail('INTERNAL', jobErr.message);

  // ---- oracle_runs untuk job yang punya baseline ----
  interface SeedRun {
    job_id: number;
    phase: 'baseline' | 'verification';
    query_index: number;
    query: string;
    engine: string;
    model: string;
    hit: boolean;
    answer: string;
    latency_ms: number;
  }

  const runs: SeedRun[] = SEEDS.filter((s) => s.baseline_score !== undefined).flatMap((s) =>
    s.queries.map((query, i) => ({
      job_id: s.job_id,
      phase: 'baseline',
      query_index: i,
      query,
      engine: 'mock-a',
      model: 'seed',
      hit: i < (s.baseline_score ?? 0),
      answer:
        i < (s.baseline_score ?? 0)
          ? `Salah satu pilihan yang sering disebut adalah ${s.brand}. (data contoh)`
          : 'Ada beberapa pilihan, tergantung kebutuhan masing-masing. (data contoh)',
      latency_ms: 120,
    }))
  );

  // ...dan verification runs untuk job yang sudah diverifikasi
  runs.push(
    ...SEEDS.filter((s) => s.verification).flatMap((s) =>
      s.verification!.subset.map((qi, pos): SeedRun => ({
        job_id: s.job_id,
        phase: 'verification',
        query_index: qi,
        query: s.queries[qi],
        engine: 'mock-a',
        model: 'seed',
        hit: pos < s.verification!.score,
        answer:
          pos < s.verification!.score
            ? `Untuk kebutuhan ini, ${s.brand} layak dipertimbangkan. (data contoh)`
            : 'Ada beberapa pilihan yang umum direkomendasikan. (data contoh)',
        latency_ms: 130,
      }))
    )
  );

  const { error: runErr } = await db().from('oracle_runs').insert(runs);
  if (runErr) return fail('INTERNAL', runErr.message);

  // ---- activity: cerminan event on-chain (palsu, khusus dev) ----
  let block = 50_000_000;
  const activity: Record<string, unknown>[] = [];
  const addActivity = (
    job: SeedJob,
    type: string,
    amountWei: string | null,
    from: string | null,
    to: string | null,
    note: string
  ) => {
    block += 1;
    activity.push({
      job_id: job.job_id,
      tx_hash: `0x${block.toString(16).padStart(64, '0')}`,
      log_index: 0,
      block_number: block,
      type,
      amount_wei: amountWei,
      from_addr: from,
      to_addr: to,
      note,
    });
  };

  for (const s of SEEDS) {
    const budget = BigInt(toWei(s.budget));
    addActivity(s, 'deposit', budget.toString(), s.client_addr, null, 'Kunci dana kontrak GEO');

    if (s.freelancer_addr) {
      addActivity(s, 'bond_lock', ((budget * 5n) / 100n).toString(), s.freelancer_addr, null, 'Kunci bond freelancer');
    }
    if (s.deliverable_content) {
      addActivity(s, 'structural_release', ((budget * 20n) / 100n).toString(), null, s.freelancer_addr ?? null, 'Structural check lolos');
    }
    if (s.status === 'ReleasedFull') {
      // Sama seperti kontrak: sisa budget + bond dalam satu transfer; bond_return hanya rincian.
      addActivity(s, 'final_release', ((budget * 80n) / 100n + (budget * 5n) / 100n).toString(), null, s.freelancer_addr ?? null, 'Target tercapai - sisa budget + bond cair');
      addActivity(s, 'bond_return', ((budget * 5n) / 100n).toString(), null, s.freelancer_addr ?? null, 'Bond freelancer dikembalikan');
    }
  }

  const { error: actErr } = await db().from('activity').insert(activity);
  if (actErr) return fail('INTERNAL', actErr.message);

  return ok({
    jobs: rows.length,
    oracleRuns: runs.length,
    activity: activity.length,
  });
});
