import type { Job, JobStatus } from './types';

/**
 * Status yang dilihat user. Ini TURUNAN, bukan kolom database.
 *
 * Smart contract hanya punya 7 status; prototipe menampilkan 10. Sisanya
 * diturunkan dari kombinasi status on-chain + job_state (kerja backend) +
 * settled_by (siapa yang memutuskan).
 *
 * Dua status tambahan di luar 10 milik prototipe — `baseline_failed` dan
 * `structural_failed` — ada karena prototipe menangani kegagalan lewat toast
 * sesaat, sementara di sini kegagalan tersimpan permanen di `job_state`.
 * Tanpa keduanya, job yang gagal akan menampilkan spinner selamanya.
 */
export type UiStatus =
  | 'baseline_running'
  | 'baseline_failed'
  | 'open'
  | 'in_progress'
  | 'submitted_pending'
  | 'structural_failed'
  | 'awaiting_verify'
  | 'verifying'
  | 'dispute'
  | 'settled_release'
  | 'settled_refund'
  | 'jury_release'
  | 'jury_refund';

/** Field minimum yang dibutuhkan — Job utuh juga diterima. */
export type UiStatusInput = Pick<
  Job,
  'status' | 'job_state' | 'baseline_score' | 'settled_by'
>;

export function deriveUiStatus(job: UiStatusInput): UiStatus {
  const failed = job.job_state === 'error';

  switch (job.status) {
    case 'Open':
      if (job.baseline_score !== null) return 'open';
      return failed ? 'baseline_failed' : 'baseline_running';

    case 'Accepted':
      return 'in_progress';

    case 'Submitted':
      return failed ? 'structural_failed' : 'submitted_pending';

    case 'Verifying':
      // job_state 'error' sengaja jatuh ke awaiting_verify: di situ tombol
      // "Verifikasi sekarang" sudah berfungsi sebagai tombol coba-lagi.
      return job.job_state === 'running_verify' ? 'verifying' : 'awaiting_verify';

    case 'Disputed':
      return 'dispute';

    case 'ReleasedFull':
      return job.settled_by === 'arbiter' ? 'jury_release' : 'settled_release';

    case 'Refunded':
      return job.settled_by === 'arbiter' ? 'jury_refund' : 'settled_refund';
  }
}

export interface UiStatusMeta {
  label: string;
  /** Kelas warna badge — mengikuti nama di prototipe HTML. */
  cls: string;
  spin?: boolean;
  /** true = ada tombol coba-lagi yang perlu ditampilkan FE. */
  retryable?: boolean;
}

export const UI_STATUS_META: Record<UiStatus, UiStatusMeta> = {
  baseline_running:  { label: 'Mengukur baseline…',      cls: 'st-amber',  spin: true },
  baseline_failed:   { label: 'Baseline gagal',          cls: 'st-rose',   retryable: true },
  open:              { label: 'Terbuka',                 cls: 'st-violet' },
  in_progress:       { label: 'Dikerjakan',              cls: 'st-violet' },
  submitted_pending: { label: 'Cek struktural…',         cls: 'st-amber',  spin: true },
  structural_failed: { label: 'Cek struktural gagal',    cls: 'st-rose',   retryable: true },
  awaiting_verify:   { label: 'Menunggu verifikasi',     cls: 'st-amber' },
  verifying:         { label: 'Oracle memverifikasi…',   cls: 'st-amber',  spin: true },
  dispute:           { label: 'Zona abu · perlu juri',   cls: 'st-warn' },
  settled_release:   { label: 'Selesai · dana cair',     cls: 'st-mint' },
  settled_refund:    { label: 'Selesai · refund',        cls: 'st-rose' },
  jury_release:      { label: 'Juri: dana cair',         cls: 'st-mint' },
  jury_refund:       { label: 'Juri: refund',            cls: 'st-rose' },
};

/**
 * Tab filter di halaman Pasar.
 *
 * `?status=` satu nilai tidak cukup: tab "Berjalan" adalah gabungan tiga
 * status on-chain. Karena itu API menerima `?filter=` dan memetakannya
 * di server.
 */
export const MARKET_FILTERS = {
  all: null,
  open: ['Open'],
  progress: ['Accepted', 'Submitted', 'Verifying'],
  dispute: ['Disputed'],
  done: ['ReleasedFull', 'Refunded'],
} as const satisfies Record<string, readonly JobStatus[] | null>;

export type MarketFilter = keyof typeof MARKET_FILTERS;

export function isMarketFilter(v: string): v is MarketFilter {
  return v in MARKET_FILTERS;
}

// ---------------------------------------------------------------------
// Kerja Oracle yang sedang berjalan — dipakai server (lock) DAN FE (UI)
// ---------------------------------------------------------------------

/** Lock kerja Oracle dianggap macet setelah 3 menit tanpa perubahan. */
export const STALE_LOCK_MS = 3 * 60_000;

/**
 * job_state yang berarti "Oracle sedang/akan bekerja" — dan karena itu bisa
 * macet kalau prosesnya mati di tengah jalan (timeout serverless, crash).
 */
export const RUNNING_STATES = [
  'queued_baseline',
  'queued_verify',
  'running_baseline',
  'running_verify',
  'running_structural',
] as const satisfies readonly Job['job_state'][];

/**
 * Lock yang macet: masih "berjalan" tapi tidak berubah > STALE_LOCK_MS.
 * acquireLock() boleh mengambil alihnya; FE menawarkan tombol coba-lagi.
 * `now` dari useNow() — null (belum ada jam) = jangan menebak.
 */
export function isStaleLock(job: Pick<Job, 'job_state' | 'job_state_at'>, now: number | null): boolean {
  if (now === null || !(RUNNING_STATES as readonly string[]).includes(job.job_state)) return false;
  const t = Date.parse(job.job_state_at);
  return Number.isFinite(t) && now - t > STALE_LOCK_MS;
}

/**
 * Status yang berubah SENDIRI di server tanpa aksi user — hanya ini yang
 * layak di-polling (blueprint Fase 9). Yang lain berubah lewat transaksi,
 * dan TxButton sudah menyegarkan cache setelahnya.
 */
export const LIVE_UI_STATUSES = ['baseline_running', 'submitted_pending', 'verifying'] as const satisfies readonly UiStatus[];

/** Perlu di-polling: status hidup dan prosesnya tidak macet (yang macet menunggu tombol coba-lagi). */
export function isLive(job: UiStatusInput & Pick<Job, 'job_state_at'>, now: number): boolean {
  return (LIVE_UI_STATUSES as readonly UiStatus[]).includes(deriveUiStatus(job)) && !isStaleLock(job, now);
}

/** Jeda polling: status hidup (Oracle bekerja) vs menunggu aksi pihak lain. */
export const POLL_FAST_MS = 4_000;
export const POLL_SLOW_MS = 30_000;

const FINAL_STATUSES: readonly JobStatus[] = ['ReleasedFull', 'Refunded'];

/**
 * Jeda polling untuk sekumpulan job yang sedang tampil (Fase 9).
 *
 *   POLL_FAST_MS  ada yang hidup (Oracle sedang bekerja, lock tidak macet)
 *   POLL_SLOW_MS  ada yang belum selesai — berubah lewat transaksi PIHAK LAIN
 *                 (freelancer mengambil, client memverifikasi, arbiter
 *                 memutus). TxButton pihak itu menyinkronkan DB; halaman
 *                 ini tinggal bertanya sesekali.
 *   false         semua sudah selesai — nol permintaan berulang
 *
 * Tab tersembunyi tidak ikut dihitung di sini: refetchIntervalInBackground
 * bawaan react-query = false, jadi polling berhenti sendiri.
 */
export function pollIntervalFor(
  jobs: readonly (UiStatusInput & Pick<Job, 'job_state_at'>)[],
  now: number
): number | false {
  if (jobs.some((j) => isLive(j, now))) return POLL_FAST_MS;
  if (jobs.some((j) => !FINAL_STATUSES.includes(j.status))) return POLL_SLOW_MS;
  return false;
}
