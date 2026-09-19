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
