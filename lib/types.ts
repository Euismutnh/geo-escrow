import type { Verdict } from './verdict';

/** Cerminan status on-chain. Ditulis HANYA oleh indexer. */
export type JobStatus =
  | 'Open'
  | 'Accepted'
  | 'Submitted'
  | 'Verifying'
  | 'Disputed'
  | 'ReleasedFull'
  | 'Refunded';

/** Status kerja backend. Ditulis HANYA oleh worker Oracle. */
export type JobState =
  | 'idle'
  | 'queued_baseline'
  | 'running_baseline'
  | 'running_structural'
  | 'queued_verify'
  | 'running_verify'
  | 'error';

export interface Job {
  job_id: number;

  // ---- pihak ----
  client_addr: string;
  freelancer_addr: string | null;
  arbiter_addr: string | null;

  // ---- isi kontrak (off-chain) ----
  brand: string;
  brief: string | null;
  queries: string[];
  target_count: number;
  multi_engine: boolean;
  query_pool_hash: string;

  // ---- uang ----
  // SEMUA nilai wei adalah STRING. Jangan pernah Number() nilai ini —
  // di atas 2^53 presisinya hilang. Pakai BigInt() untuk berhitung.
  budget_wei: string;
  bond_wei: string | null;
  structural_released_wei: string;

  // ---- deliverable ----
  deliverable_content: string | null;
  deliverable_hash: string | null;
  deliverable_submitted_at: string | null;

  // ---- baseline (T0) ----
  baseline_score: number | null;
  baseline_of: number | null;
  baseline_at: string | null;

  // ---- verifikasi (T1) ----
  verification_seed: string | null;
  verification_subset: number[] | null;
  verification_score: number | null;
  verification_of: number | null;
  verification_decision: 'release' | 'refund' | 'dispute' | null;
  verification_at: string | null;
  verdict_hash: string | null;
  verdict_json: Verdict | null;

  // ---- status ----
  status: JobStatus;
  job_state: JobState;
  job_state_at: string;
  settled_by: 'oracle' | 'arbiter' | null;
  last_error: string | null;

  // ---- waktu ----
  accept_deadline: string | null;
  created_at: string;
  updated_at: string;
}

export interface OracleRun {
  id: string;
  job_id: number;
  phase: 'baseline' | 'verification';
  query_index: number;
  query: string;
  engine: string;
  model: string | null;
  hit: boolean;
  answer: string;
  latency_ms: number | null;
  created_at: string;
}

export interface ActivityEntry {
  id: string;
  job_id: number | null;
  tx_hash: string;
  log_index: number;
  block_number: number;
  type: string;
  amount_wei: string | null;
  from_addr: string | null;
  to_addr: string | null;
  note: string | null;
  created_at: string;
}
