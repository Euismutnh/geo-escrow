import { db } from '../db';
import { env } from '../env';
import { MIN_BUDGET_WEI } from '../job-input';
import { getJob, acquireLock, releaseLock } from '../jobs-repo';
import { ApiError, internalError, publicErrorMessage } from '../http';
import { provider, enginesFor, textHitsBrand } from './index';
import { hitPerQuery, type RunHit } from '../scoring';
import type { Job } from '../types';

/**
 * Berapa panggilan AI yang boleh berjalan bersamaan.
 *
 * Bukan angka asal. Batas atasnya: maxDuration route = 60 detik. Kasus
 * terberat adalah 6 pertanyaan x 2 engine = 12 panggilan. Claude Opus 5
 * dengan thinking realistis 3-6 detik per panggilan, jadi BERURUTAN
 * butuh 36-72 detik -- yang berarti job multi-engine hampir pasti
 * kehabisan waktu. Dengan 3 sekaligus, 12 panggilan turun ke ~20 detik.
 *
 * Batas bawahnya: jangan terlalu tinggi supaya tidak memicu rate limit
 * provider. 3 adalah kompromi yang aman untuk keduanya.
 */
const CONCURRENCY = 3;

/**
 * Jalankan `fn` untuk tiap item, maksimal `limit` sekaligus.
 *
 * Error per item SENGAJA ditangkap, bukan dibiarkan melempar: kalau satu
 * panggilan gagal di tengah, pekerja lain harus tetap selesai supaya
 * hasilnya sempat tersimpan ke oracle_runs -- itu yang membuat percobaan
 * berikutnya bisa melewatinya. Error pertama dilempar ulang setelah
 * semua pekerja berhenti.
 *
 * Diekspor supaya bisa diuji langsung -- lihat scripts/check-oracle.ts.
 */
export async function mapWithLimit<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let cursor = 0;
  let firstError: unknown = null;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        await fn(items[i]);
      } catch (e) {
        firstError ??= e;
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );

  if (firstError) throw firstError;
}

export interface RunPhaseOpts {
  phase: 'baseline' | 'verification';
  /** Indeks pertanyaan yang dikerjakan. Baseline = semua; verifikasi = subset VRF. */
  indices: number[];
  /** Isi deliverable -- hanya pada fase verifikasi. */
  contextContent?: string;
}

interface Task {
  index: number;
  query: string;
  engineId: string;
}

/**
 * Ukur sitasi brand untuk sekumpulan pertanyaan.
 *
 * RESUMABLE: kombinasi (job, phase, query_index, engine) yang barisnya
 * sudah ada di oracle_runs akan dilewati. Jadi kalau proses mati di
 * tengah -- timeout serverless, provider error, jaringan putus --
 * pemanggilan ulang melanjutkan dari yang belum selesai, bukan mengulang
 * semuanya. Tanpa ini, tiap kegagalan membuang seluruh panggilan AI yang
 * sudah dibayar.
 *
 * Mengembalikan hit per indeks pertanyaan.
 */
export async function runPhase(
  job: Job,
  opts: RunPhaseOpts
): Promise<Map<number, boolean>> {
  if (job.queries.length === 0) {
    throw new ApiError('WRONG_STATUS', 'Job tidak punya pertanyaan');
  }

  // Melempar OracleError kalau multi_engine diminta tapi provider cuma
  // punya 1 engine -- lebih baik gagal daripada diam-diam mengukur sekali
  // lalu mencatatnya sebagai multi-engine.
  const engines = enginesFor(job.multi_engine);
  const p = provider();

  // Baca yang sudah selesai SEKALI di awal, bukan per-panggilan.
  const { data: existing, error: readErr } = await db()
    .from('oracle_runs')
    .select('query_index, engine, hit')
    .eq('job_id', job.job_id)
    .eq('phase', opts.phase);

  if (readErr) throw internalError('membaca hasil Oracle', readErr);

  const results = new Map<string, boolean>();
  // Daftar datar semua hasil — bahan untuk hitPerQuery() di akhir.
  const collected: RunHit[] = [];
  for (const r of existing ?? []) {
    results.set(`${r.query_index}:${r.engine}`, r.hit);
    collected.push({ query_index: r.query_index, engine: r.engine, hit: r.hit });
  }

  // Ratakan jadi satu daftar tugas supaya bisa dijalankan berbarengan
  // lintas pertanyaan DAN lintas engine.
  const tasks: Task[] = [];
  for (const index of opts.indices) {
    const query = job.queries[index];
    if (query === undefined) {
      throw new ApiError('WRONG_STATUS', `Indeks pertanyaan ${index} di luar jangkauan`);
    }
    for (const engine of engines) {
      if (results.has(`${index}:${engine.id}`)) continue; // sudah pernah
      tasks.push({ index, query, engineId: engine.id });
    }
  }

  // S-09 (Fase 10): biaya AI sungguhan dibatasi SEBELUM memanggil. Mock gratis.
  if (tasks.length > 0 && p.id !== 'mock') await assertAiBudget(job, tasks.length);

  await mapWithLimit(tasks, CONCURRENCY, async (task) => {
    const engine = engines.find((e) => e.id === task.engineId)!;

    // brand WAJIB ikut, tapi HANYA dipakai provider mock. Prompt yang
    // dikirim ke AI sungguhan tidak pernah memuatnya -- lihat prompt.ts.
    const res = await p.ask({
      query: task.query,
      engine,
      brand: job.brand,
      contextContent: opts.contextContent,
    });

    const hit = textHitsBrand(res.answer, job.brand);
    results.set(`${task.index}:${task.engineId}`, hit);
    collected.push({ query_index: task.index, engine: task.engineId, hit });

    // Simpan SEGERA, satu per satu. Kalau proses mati setelah baris ini,
    // panggilan AI tadi tidak terbuang percuma.
    //
    // upsert + ignoreDuplicates, bukan insert: kalau lock sempat
    // dibebaskan reclaimStaleLocks() sementara proses lama masih hidup,
    // dua proses bisa menulis baris yang sama. Dengan insert biasa,
    // tabrakan itu melempar error dan menggagalkan seluruh fase. Di sini
    // baris kedua cukup diabaikan.
    const { error: insErr } = await db()
      .from('oracle_runs')
      .upsert(
        {
          job_id: job.job_id,
          phase: opts.phase,
          query_index: task.index,
          query: task.query,
          engine: task.engineId,
          model: res.model,
          hit,
          answer: res.answer,
          latency_ms: res.latencyMs,
        },
        { onConflict: 'job_id,phase,query_index,engine', ignoreDuplicates: true }
      );

    if (insErr) throw internalError('menyimpan hasil Oracle', insErr);
  });

  // Aturan gabungnya ("hit hanya kalau lolos di SEMUA engine") tinggal di
  // lib/scoring.ts — dipakai bersama radar sitasi di frontend, supaya angka
  // di layar tidak bisa berbeda dari skor verdict.
  const combined = hitPerQuery(collected, engines.map((e) => e.id));

  const perQuery = new Map<number, boolean>();
  for (const index of opts.indices) {
    const hit = combined.get(index);

    // Tidak boleh undefined di sini: semuanya sudah dijalankan atau sudah
    // ada dari sebelumnya. Kalau ada, lebih baik gagal daripada
    // memperlakukan "tidak diketahui" sebagai "tidak disebut".
    if (hit === undefined) {
      throw new ApiError('INTERNAL', `Hasil tidak lengkap untuk pertanyaan #${index + 1}`);
    }

    perQuery.set(index, hit);
  }

  return perQuery;
}

/**
 * Penjaga biaya AI sungguhan (temuan audit S-09):
 *   1. budget kontrak ≥ MIN_BUDGET_WEI — kontrak 1 wei (dibuat di luar
 *      aplikasi) tidak boleh memicu 12 panggilan AI;
 *   2. kuota 24 jam GLOBAL dan PER CLIENT, dihitung dari oracle_runs —
 *      berlaku lintas instance, berbeda dari rate limit di memori.
 * Hitungannya sedikit longgar (dua proses bisa lolos bersamaan) — cukup
 * untuk membatasi pengurasan; bukan akuntansi tagihan.
 */
async function assertAiBudget(job: Job, planned: number): Promise<void> {
  if (BigInt(job.budget_wei) < MIN_BUDGET_WEI) {
    throw new ApiError('WRONG_STATUS', 'Budget kontrak di bawah minimum 0,0005 tBNB — tidak diukur dengan AI sungguhan.');
  }
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();

  const { count: global, error: gErr } = await db()
    .from('oracle_runs')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
    .not('model', 'like', 'mock%');
  if (gErr) throw internalError('menghitung kuota AI', gErr);
  if ((global ?? 0) + planned > env.oracleDailyCallLimit) {
    throw new ApiError('RATE_LIMITED', 'Kuota panggilan AI harian platform tercapai — coba lagi nanti.');
  }

  const { count: mine, error: cErr } = await db()
    .from('oracle_runs')
    .select('id, jobs!inner(client_addr)', { count: 'exact', head: true })
    .gte('created_at', since)
    .not('model', 'like', 'mock%')
    .eq('jobs.client_addr', job.client_addr.toLowerCase());
  if (cErr) throw internalError('menghitung kuota AI client', cErr);
  if ((mine ?? 0) + planned > env.oracleClientDailyCallLimit) {
    throw new ApiError('RATE_LIMITED', 'Kuota panggilan AI harian untuk client ini tercapai — coba lagi nanti.');
  }
}

export interface BaselineResult {
  score: number;
  of: number;
  /** true kalau semua run diambil dari hasil sebelumnya (tidak ada panggilan AI baru). */
  fromCache: boolean;
}

/**
 * Ukur baseline (T0) -- berapa pertanyaan yang menyebut brand SEBELUM
 * ada optimasi apa pun.
 *
 * Lock diambil secara atomik, jadi dua pemanggilan bersamaan tidak akan
 * sama-sama jalan. Yang kedua ditolak dengan ApiError('BUSY').
 */
export async function runBaseline(jobId: number): Promise<BaselineResult> {
  // Baseline = T0, SEBELUM ada yang mengerjakan. Di status lain ia tidak
  // bermakna — dan berbahaya: lock di bawah menerima 'error', lalu sukses
  // menulis job_state='idle'. Pada job Verifying yang settlement-nya gagal,
  // 'error' itulah satu-satunya penanda "lanjutkan settlement" (lihat
  // lib/flows/verify.ts); menimpanya jadi 'idle' membuat /verify menjawab
  // "sudah diverifikasi" selamanya dan dana tertahan sampai eskalasi.
  const preview = await getJob(jobId);
  if (preview.status !== 'Open' || preview.verification_decision) {
    throw new ApiError(
      'WRONG_STATUS',
      `Baseline hanya diukur saat kontrak masih terbuka (sekarang ${preview.status})`
    );
  }

  const locked = await acquireLock(
    jobId,
    ['idle', 'queued_baseline', 'error'],
    'running_baseline'
  );
  if (!locked) throw new ApiError('BUSY', 'Baseline sedang berjalan untuk job ini');

  try {
    const job = await getJob(jobId);

    const { count: before } = await db()
      .from('oracle_runs')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('phase', 'baseline');

    const indices = job.queries.map((_, i) => i);
    const perQuery = await runPhase(job, { phase: 'baseline', indices });
    const score = [...perQuery.values()].filter(Boolean).length;

    const { count: after } = await db()
      .from('oracle_runs')
      .select('*', { count: 'exact', head: true })
      .eq('job_id', jobId)
      .eq('phase', 'baseline');

    const { error } = await db()
      .from('jobs')
      .update({
        baseline_score: score,
        baseline_of: job.queries.length,
        baseline_at: new Date().toISOString(),
        job_state: 'idle',
        last_error: null,
      })
      .eq('job_id', jobId);

    if (error) throw internalError('menyimpan hasil baseline', error);

    return { score, of: job.queries.length, fromCache: (after ?? 0) === (before ?? 0) };
  } catch (e) {
    // Dilepas ke 'error', BUKAN 'idle' -- supaya UI bisa membedakan
    // "gagal, silakan coba lagi" dari "belum pernah dijalankan", dan
    // menampilkan tombol coba-lagi (lihat deriveUiStatus -> baseline_failed).
    await releaseLock(jobId, 'error', publicErrorMessage(e, 'Kesalahan sistem — detail tercatat di log server'));
    throw e;
  }
}
