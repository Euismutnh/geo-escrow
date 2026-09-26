-- ============================================================
-- GEO Escrow — skema dasar Supabase (Postgres)
-- ============================================================
-- Disalin APA ADANYA dari geo-escrow-backend-blueprint-v2.md §3.2 (27-09-2026,
-- temuan audit BE-26: skema tidak ada di repo). Urutan menjalankan di
-- database baru:
--   1. schema-00-base.sql                          (file ini)
--   2. migration-01-activity-types-and-arbiter.sql (tipe activity + hapus arbiter_addr)
--
-- RLS: SENGAJA tidak dinyalakan (keputusan 2026-09-13, blueprint §3.3). Aman
-- selama browser tidak pernah memakai anon key — semua akses lewat API server
-- dengan service_role. WAJIB dinyalakan (plus policy) sebelum anon key dipakai.
--
-- Kolom yang ditulis aplikasi & dipakai kode (terverifikasi 26-09-2026 ke DB
-- hidup): deliverable_submitted_at, settled_by, verdict_hash, job_state_at.
-- Relasi oracle_runs.job_id → jobs dipakai embed PostgREST `jobs!inner(...)`
-- (kuota AI, lib/oracle/runner.ts) — terverifikasi 27-09-2026.
-- ============================================================

create domain wei as text check (value ~ '^[0-9]+$');

-- ------------------------------------------------------------
-- jobs — satu baris = satu kontrak GEO
-- ------------------------------------------------------------
create table jobs (
  job_id                   bigint primary key,
  -- Sama persis dengan jobId di smart contract (bukan auto-increment),
  -- supaya event on-chain langsung bisa dicocokkan.

  -- ---- pihak ----
  client_addr              text not null,
  freelancer_addr          text,

  -- ---- isi kontrak (off-chain, ditulis route POST) ----
  brand                    text not null,
  brief                    text,
  queries                  jsonb not null,
  target_count             int  not null,
  multi_engine             boolean not null default false,
  query_pool_hash          text not null,
  -- keccak256 dari canonicalQueryPool(). WAJIB cocok dengan yang
  -- tersimpan on-chain — ini satu-satunya gerbang keaslian data.

  -- ---- uang (ditulis HANYA indexer) ----
  budget_wei               wei  not null,
  bond_wei                 wei,
  structural_released_wei  wei  not null default '0',

  -- ---- deliverable ----
  deliverable_content      text,
  deliverable_hash         text,
  deliverable_submitted_at timestamptz,

  -- ---- baseline (T0) ----
  baseline_score           int,
  baseline_of              int,
  baseline_at              timestamptz,

  -- ---- verifikasi (T1) ----
  verification_seed        text,
  -- Seed dari on-chain (block.prevrandao saat confirmStructural).
  -- Subset diturunkan deterministik dari sini → bisa diaudit ulang.
  verification_subset      jsonb,
  verification_score       int,
  verification_of          int,
  verification_decision    text check (verification_decision in ('release','refund','dispute')),
  verification_at          timestamptz,
  verdict_hash             text,
  verdict_json             jsonb,
  -- Verdict lengkap disimpan supaya siapa pun bisa menghitung ulang
  -- verdict_hash dan mencocokkannya dengan yang di blockchain.

  -- ---- status ----
  status                   text not null default 'Open'
    check (status in ('Open','Accepted','Submitted','Verifying','Disputed','ReleasedFull','Refunded')),
  job_state                text not null default 'idle'
    check (job_state in ('idle','queued_baseline','running_baseline','running_structural','queued_verify','running_verify','error')),
  job_state_at             timestamptz default now(),
  -- Dipakai untuk mendeteksi lock yang macet (lihat 6.5 "stale lock").
  settled_by               text check (settled_by in ('oracle','arbiter')),
  last_error               text,

  -- ---- waktu ----
  accept_deadline          timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index idx_jobs_status     on jobs (status);
create index idx_jobs_client     on jobs (client_addr);
create index idx_jobs_freelancer on jobs (freelancer_addr);
create index idx_jobs_created    on jobs (created_at desc);

-- ------------------------------------------------------------
-- oracle_runs — arsip mentah tiap panggilan AI
-- ------------------------------------------------------------
create table oracle_runs (
  id            uuid primary key default gen_random_uuid(),
  job_id        bigint not null references jobs(job_id) on delete cascade,
  phase         text   not null check (phase in ('baseline','verification')),
  query_index   int    not null,
  query         text   not null,
  engine        text   not null,
  model         text,
  hit           boolean not null,
  answer        text   not null,
  latency_ms    int,
  created_at    timestamptz not null default now(),

  unique (job_id, phase, query_index, engine)
  -- ^ KUNCI RESUMABILITY. Kalau baseline mati di tengah karena timeout,
  --   pemanggilan ulang tinggal melewati baris yang sudah ada.
  --   Tanpa ini, retry menghasilkan data ganda dan skor yang salah.
);
create index idx_oracle_runs_job on oracle_runs (job_id, phase, query_index);

-- ------------------------------------------------------------
-- activity — ledger, cerminan event on-chain
-- ------------------------------------------------------------
create table activity (
  id            uuid primary key default gen_random_uuid(),
  job_id        bigint references jobs(job_id) on delete cascade,
  tx_hash       text   not null,
  log_index     int    not null,
  block_number  bigint not null,
  type          text   not null check (type in (
                  'deposit','bond_lock','structural_release','structural_rejected',
                  'dispute_raised','vrf_pick',
                  'final_release','final_refund','jury_release','jury_refund',
                  'bond_return','bond_slash','reclaim')),
  amount_wei    wei,
  from_addr     text,
  to_addr       text,
  note          text,
  created_at    timestamptz not null default now(),

  unique (tx_hash, log_index)
  -- ^ Mencegah baris ganda kalau indexer jalan dua kali atau ada retry.
);
create index idx_activity_job     on activity (job_id, created_at desc);
create index idx_activity_created on activity (created_at desc);

-- ------------------------------------------------------------
-- indexer_state — bookmark progres indexer, PER ALAMAT KONTRAK
-- ------------------------------------------------------------
create table indexer_state (
  contract_addr        text primary key,
  last_block_processed bigint not null default 0,
  updated_at           timestamptz not null default now()
);
-- ^ Di-key per alamat, BUKAN id=1. Selama hackathon kalian pasti akan
--   re-deploy kontrak; kalau bookmark-nya global, indexer akan mulai dari
--   blok kontrak lama dan melewatkan semua event kontrak baru.

-- ------------------------------------------------------------
-- updated_at otomatis
-- ------------------------------------------------------------
create or replace function touch_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger jobs_touch before update on jobs
  for each row execute function touch_updated_at();
