import { db } from './db';
import { ApiError } from './http';
import { MARKET_FILTERS, type MarketFilter } from './status';
import type { Job, OracleRun, ActivityEntry, JobState } from './types';

export async function getJob(jobId: number): Promise<Job> {
  const { data, error } = await db()
    .from('jobs')
    .select('*')
    .eq('job_id', jobId)
    .maybeSingle();

  if (error) throw new ApiError('INTERNAL', error.message);
  if (!data) throw new ApiError('NOT_FOUND', 'Job tidak ditemukan');
  return data as Job;
}

export interface ListJobsOpts {
  filter?: MarketFilter;
  /** Sudah divalidasi lewat parseAddress() -- dijamin [0-9a-f] saja. */
  wallet?: string;
  page?: number;
  limit?: number;
}

export async function listJobs(opts: ListJobsOpts) {
  const page = opts.page ?? 1;
  const limit = opts.limit ?? 20;

  let q = db()
    .from('jobs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  const statuses = opts.filter ? MARKET_FILTERS[opts.filter] : null;
  if (statuses) q = q.in('status', [...statuses]);

  if (opts.wallet) {
    // Aman diinterpolasi HANYA karena parseAddress() sudah memastikan
    // nilainya cocok /^0x[0-9a-f]{40}$/ -- tidak ada koma/kurung/titik
    // yang bisa mengubah arti filter PostgREST.
    q = q.or(`client_addr.eq.${opts.wallet},freelancer_addr.eq.${opts.wallet}`);
  }

  const { data, error, count } = await q;
  if (error) throw new ApiError('INTERNAL', error.message);

  return { jobs: (data ?? []) as Job[], total: count ?? 0, page, limit };
}

export async function getRuns(
  jobId: number,
  phase?: 'baseline' | 'verification'
): Promise<OracleRun[]> {
  let q = db()
    .from('oracle_runs')
    .select('*')
    .eq('job_id', jobId)
    .order('query_index', { ascending: true })
    .order('created_at', { ascending: true });

  if (phase) q = q.eq('phase', phase);

  const { data, error } = await q;
  if (error) throw new ApiError('INTERNAL', error.message);
  return (data ?? []) as OracleRun[];
}

export async function getActivity(
  jobId?: number,
  limit = 150
): Promise<ActivityEntry[]> {
  let q = db()
    .from('activity')
    .select('*')
    .order('block_number', { ascending: false })
    .order('log_index', { ascending: false })
    .limit(limit);

  if (jobId !== undefined) q = q.eq('job_id', jobId);

  const { data, error } = await q;
  if (error) throw new ApiError('INTERNAL', error.message);
  return (data ?? []) as ActivityEntry[];
}

/**
 * Ambil lock pekerjaan secara ATOMIK.
 *
 * "UPDATE ... WHERE job_state IN (...)" adalah satu operasi tunggal di
 * Postgres. Kalau dua request datang bersamaan, hanya satu yang mendapat
 * baris; yang kedua dapat 0 baris dan ditolak.
 *
 * Pola "baca dulu, cek, lalu tulis" TIDAK aman di sini -- ada celah di
 * antara baca dan tulis yang membuat dua proses bisa sama-sama lolos.
 */
export async function acquireLock(
  jobId: number,
  from: JobState[],
  to: JobState
): Promise<boolean> {
  const { data, error } = await db()
    .from('jobs')
    .update({
      job_state: to,
      job_state_at: new Date().toISOString(),
      last_error: null,
    })
    .eq('job_id', jobId)
    .in('job_state', from)
    .select('job_id');

  if (error) throw new ApiError('INTERNAL', error.message);
  return (data ?? []).length > 0;
}

export async function releaseLock(
  jobId: number,
  to: JobState = 'idle',
  lastError?: string
): Promise<void> {
  const { error } = await db()
    .from('jobs')
    .update({
      job_state: to,
      job_state_at: new Date().toISOString(),
      last_error: lastError ?? null,
    })
    .eq('job_id', jobId);

  if (error) throw new ApiError('INTERNAL', error.message);
}

/** Lock dianggap macet setelah 3 menit tanpa perubahan. */
const STALE_LOCK_MS = 3 * 60_000;

/**
 * State yang dianggap "sedang berjalan" dan karena itu bisa macet.
 *
 * `queued_baseline` ikut masuk, bukan hanya `running_*`. Alasannya: job
 * dibuat dengan state itu, lalu `after()` yang memulai baselinenya.
 * Kalau proses mati SEBELUM `after()` sempat berjalan, job tertinggal di
 * `queued_baseline` dan TIDAK ADA yang akan memungutnya -- baseline tidak
 * pernah terukur, tanpa pesan error apa pun. Dengan dimasukkan ke sini,
 * job tersebut jatuh ke 'error' dan UI menampilkan tombol coba-lagi.
 */
const STUCK_STATES: JobState[] = [
  'queued_baseline',
  'queued_verify',
  'running_baseline',
  'running_verify',
  'running_structural',
];

/**
 * Bebaskan job yang lock-nya kedaluwarsa.
 *
 * Kalau proses mati SETELAH mengambil lock tapi SEBELUM melepasnya
 * (timeout serverless, crash), job akan macet selamanya. Dipanggil dari
 * cron indexer.
 */
export async function reclaimStaleLocks(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();

  const { data, error } = await db()
    .from('jobs')
    .update({
      job_state: 'error',
      last_error: 'Worker timeout -- silakan coba lagi',
    })
    .in('job_state', STUCK_STATES)
    .lt('job_state_at', cutoff)
    .select('job_id');

  if (error) throw new ApiError('INTERNAL', error.message);
  return (data ?? []).length;
}
