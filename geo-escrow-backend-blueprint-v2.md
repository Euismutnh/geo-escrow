# GEO Escrow — Blueprint Backend v2

> **Menggantikan** `geo-escrow-roadmap-backend.md`. Dokumen ini menyelaraskan tiga sumber:
> prototipe `geo-escrow-demo-neobrutalism.html`, `geo-escrow-ringkasan-3-bagian.md`, dan roadmap v1.
>
> Target: Next.js **16.3.3** (App Router, tanpa `src/`) + Supabase + BNB Chain Testnet.
> Semua path relatif ke root project.

---

## Cara pakai dokumen ini

- **Bagian 1–5 dibaca sekali di awal.** Ini kesepakatan — kalau ini berubah di tengah jalan, kode harus dibongkar.
- **Bagian 6 dikerjakan berurutan.** Tiap fase punya kotak "Selesai kalau" — jangan lanjut sebelum itu hijau.
- **Bagian 7** adalah checklist yang harus kamu kirim ke orang blockchain & FE. Kirim **hari ini**, karena beberapa di antaranya mengubah smart contract.

### Yang berubah dari roadmap v1

| # | v1 | v2 | Kenapa |
|---|---|---|---|
| 1 | 7 status on-chain saja | `status` + `job_state` + `settled_by` → 10 status UI diturunkan | Prototipe butuh 10, on-chain cuma punya 7 |
| 2 | Tanpa auth | Hash-gated writes | Siapa saja bisa membakar kredit AI + memicu tx |
| 3 | `budget_wei numeric` | `budget_wei text` + BigInt | `numeric` hilang presisi di atas ~0.009 tBNB |
| 4 | `verdictHash` tak terdefinisi | Verdict kanonik + endpoint audit | Ini inti klaim "trustless" |
| 5 | `Math.random()` untuk VRF | Seed on-chain → subset deterministik | Oracle bisa curang memilih subset |
| 6 | Float + epsilon `-0.001` | Aritmetika integer murni | Hasil bisa dihitung ulang siapa saja |
| 7 | Hash deliverable tidak dicek | Wajib cocok dengan on-chain | Freelancer bisa commit A kirim B |
| 8 | Route & indexer sama-sama tulis `status` | Indexer satu-satunya penulis | Race condition, status bisa mundur |
| 9 | `fetch()` fire-and-forget | `after()` dari `next/server` | Pola resmi Next 16 |
| 10 | Baseline sekali jalan | Baseline **resumable** | Serverless timeout = kerjaan hilang |
| 11 | Fase 4 sebelum Fase 5 & 7 | Mode `CHAIN_ENABLED=false` + `ORACLE_PROVIDER=mock` | v1 punya dependensi terbalik; kamu terblokir menunggu kontrak |

---

# BAGIAN 1 — Arsitektur

## 1.1 Peta sistem

```
┌──────────────┐   fetch JSON   ┌────────────────────────────────┐
│   Browser    │ ─────────────► │  Next.js app/api/*  = backend  │
│  (Next FE)   │ ◄───────────── │                                │
└──────┬───────┘                └────┬──────────────────┬────────┘
       │                             │                  │
       │ wagmi/viem                  │ service_role     │ secrets
       │ (tanda tangan tx)           ▼                  ▼
       │                    ┌────────────────┐  ┌──────────────────┐
       │                    │ Supabase (PG)  │  │ AI provider      │
       │                    │ jobs           │  │ Wallet Oracle    │
       │ (FE TIDAK menyentuh│ oracle_runs    │  │ RPC BNB Chain    │
       │  Supabase langsung)│ activity       │  └──────────────────┘
       └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─│ indexer_state  │
                            └────────────────┘
                                     ▲
                                     │ event on-chain
                            ┌────────┴────────┐
                            │  GeoEscrow.sol  │
                            └─────────────────┘
```

**Tiga jalur tulis ke DB, dan hanya tiga:**

| Jalur | Menulis apa | Tidak boleh menulis |
|---|---|---|
| Route `POST` (user) | Kolom off-chain: `brand`, `brief`, `queries`, `deliverable_content` | `status`, kolom uang |
| Worker Oracle | `baseline_*`, `verification_*`, `oracle_runs`, `job_state` | `status`, kolom uang |
| **Indexer** | `status`, semua kolom uang, `activity`, `settled_by` | — |

> **Aturan emas:** `status` dan semua kolom uang **hanya** ditulis indexer. Kalau route API menulisnya juga, indexer yang memproses blok lama bisa memundurkan status. Ini penyebab bug paling licin di sistem semacam ini.

## 1.2 Dua flag yang membuatmu tidak terblokir

```bash
CHAIN_ENABLED=false      # Fase 0–8: backend jalan penuh tanpa smart contract
ORACLE_PROVIDER=mock     # Fase 0–8: tanpa API key AI, gratis, hasil bisa diulang
```

Dengan dua flag ini kamu bisa membangun & mendemokan **seluruh backend + frontend** sebelum kontrak selesai. Saat kontrak siap, ubah jadi `true`/`claude` — tidak ada kode yang perlu diubah.

`CHAIN_ENABLED=false` mengubah perilaku di tiga titik saja:
- Verifikasi hash on-chain di-skip (hash tetap dihitung & disimpan)
- Panggilan `writeContract` diganti no-op yang mengembalikan tx hash palsu
- Indexer mengembalikan `{ skipped: true }`

---

# BAGIAN 2 — Model Status (paling penting)

## 2.1 Masalahnya

Prototipe punya **10** status. Smart contract punya **7**. Yang tidak bisa diwakili on-chain:

- "baseline sedang diukur" — pekerjaan backend, blockchain tidak tahu-menahu
- "oracle sedang verifikasi" — sama
- "diputus juri" vs "diputus oracle" — on-chain dua-duanya `ReleasedFull`

## 2.2 Solusinya: tiga kolom, satu fungsi turunan

```
status       : mirror on-chain, ditulis HANYA oleh indexer
               'Open' | 'Accepted' | 'Submitted' | 'Verifying' | 'Disputed'
               | 'ReleasedFull' | 'Refunded'

job_state    : status kerja backend, ditulis HANYA oleh worker
               'idle' | 'queued_baseline' | 'running_baseline'
               | 'running_structural' | 'queued_verify' | 'running_verify' | 'error'

settled_by   : 'oracle' | 'arbiter' | null   (ditulis indexer)
```

## 2.3 Tabel pemetaan lengkap

| Status UI (prototipe) | `status` | Syarat tambahan |
|---|---|---|
| `baseline_running` | `Open` | `baseline_score IS NULL` dan `job_state <> 'error'` |
| 🆕 `baseline_failed` | `Open` | `baseline_score IS NULL` dan `job_state = 'error'` |
| `open` | `Open` | `baseline_score IS NOT NULL` |
| `in_progress` | `Accepted` | — |
| 🆕 `submitted_pending` | `Submitted` | `job_state <> 'error'` — menunggu structural check backend |
| 🆕 `structural_failed` | `Submitted` | `job_state = 'error'` |
| `awaiting_verify` | `Verifying` | `job_state <> 'running_verify'` (termasuk `error` → tombol Verifikasi jadi tombol coba-lagi) |
| `verifying` | `Verifying` | `job_state = 'running_verify'` |
| `dispute` | `Disputed` | — |
| `settled_release` | `ReleasedFull` | `settled_by = 'oracle'` |
| `jury_release` | `ReleasedFull` | `settled_by = 'arbiter'` |
| `settled_refund` | `Refunded` | `settled_by = 'oracle'` |
| `jury_refund` | `Refunded` | `settled_by = 'arbiter'` |

**Tiga status di luar 10 milik prototipe:**

- **`submitted_pending`** — di prototipe, structural check terjadi seketika di browser. Di sistem nyata ada jeda antara freelancer menandatangani `submitDeliverable` dan Oracle memanggil `confirmStructural`. Jeda itu perlu punya nama.
- **`baseline_failed`** dan **`structural_failed`** — prototipe menangani kegagalan lewat toast sesaat lalu mengembalikan status ke semula. Di sini kegagalan **tersimpan permanen** di `job_state = 'error'`. Tanpa dua status ini, `deriveUiStatus` akan mengembalikan `baseline_running` / `submitted_pending` untuk job yang sebenarnya sudah gagal — dan UI menampilkan **spinner selamanya**. Keduanya bertanda `retryable: true`, bukan `spin: true`.

## 2.4 `lib/status.ts` — dipakai FE **dan** BE

```ts
import type { Job } from './types';

export type UiStatus =
  | 'baseline_running' | 'baseline_failed' | 'open' | 'in_progress'
  | 'submitted_pending' | 'structural_failed'
  | 'awaiting_verify' | 'verifying' | 'dispute'
  | 'settled_release' | 'settled_refund' | 'jury_release' | 'jury_refund';

/** Field minimum yang dibutuhkan — Job utuh juga diterima. */
export type UiStatusInput = Pick<
  Job, 'status' | 'job_state' | 'baseline_score' | 'settled_by'
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
      // 'error' sengaja jatuh ke awaiting_verify: tombol "Verifikasi
      // sekarang" di situ sudah berfungsi sebagai tombol coba-lagi.
      return job.job_state === 'running_verify' ? 'verifying' : 'awaiting_verify';
    case 'Disputed':
      return 'dispute';
    case 'ReleasedFull':
      return job.settled_by === 'arbiter' ? 'jury_release' : 'settled_release';
    case 'Refunded':
      return job.settled_by === 'arbiter' ? 'jury_refund' : 'settled_refund';
  }
}

// Label & warna — port langsung dari STATUS_META di prototipe HTML
export const UI_STATUS_META: Record<UiStatus, { label: string; cls: string; spin?: boolean }> = {
  baseline_running: { label: 'Mengukur baseline…',    cls: 'st-amber',  spin: true },
  open:             { label: 'Terbuka',                cls: 'st-violet' },
  in_progress:      { label: 'Dikerjakan',             cls: 'st-violet' },
  submitted_pending:{ label: 'Cek struktural…',        cls: 'st-amber',  spin: true },
  awaiting_verify:  { label: 'Menunggu verifikasi',    cls: 'st-amber' },
  verifying:        { label: 'Oracle memverifikasi…',  cls: 'st-amber',  spin: true },
  dispute:          { label: 'Zona abu · perlu juri',  cls: 'st-warn' },
  settled_release:  { label: 'Selesai · dana cair',    cls: 'st-mint' },
  settled_refund:   { label: 'Selesai · refund',       cls: 'st-rose' },
  jury_release:     { label: 'Juri: dana cair',        cls: 'st-mint' },
  jury_refund:      { label: 'Juri: refund',           cls: 'st-rose' },
};
```

## 2.5 Filter pasar

Prototipe punya tab `Semua / Terbuka / Berjalan / Perlu juri / Selesai`. `?status=` satu nilai tidak cukup — "Berjalan" adalah gabungan beberapa status. Backend menerima `?filter=`:

```ts
export const MARKET_FILTERS = {
  all:      null,
  open:     ['Open'],
  progress: ['Accepted', 'Submitted', 'Verifying'],
  dispute:  ['Disputed'],
  done:     ['ReleasedFull', 'Refunded'],
} as const;
```

---

# BAGIAN 3 — Database

## 3.1 Keputusan tipe kolom uang

**Jangan pakai `numeric` untuk wei.** Supabase menyajikan `numeric` lewat PostgREST sebagai JSON *number*, dan JavaScript number hanya eksak sampai 2⁵³ ≈ 9×10¹⁵ wei ≈ **0,009 tBNB**. Budget 0,02 tBNB = 2×10¹⁶ sudah melewatinya.

Yang membuat ini berbahaya: angka bulat seperti 2×10¹⁶ *kebetulan* masih eksak, jadi selama pengembangan semuanya tampak normal. Kesalahan baru muncul pada nilai yang bukan kelipatan pangkat dua — misal sisa pembagian 80% budget. Bug intermiten yang sangat sulit dilacak.

**Pakai `text`**, dengan CHECK constraint agar hanya digit, dan `BigInt` di TypeScript.

## 3.2 Skema SQL lengkap

Jalankan di **Supabase → SQL Editor → New Query → Run**.

```sql
-- ============================================================
-- GEO Escrow — skema v2
-- ============================================================

-- Domain: wei disimpan sebagai teks digit, supaya tidak kehilangan
-- presisi saat lewat JSON. Semua aritmetika pakai BigInt di aplikasi.
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
```

## 3.3 RLS + Realtime — **DILEWATI (keputusan 2026-09-13)**

> **Status: tidak dijalankan.** Kita memilih **polling** (`setInterval` + `fetch` di FE), bukan Supabase Realtime. Skema §3.2 dijalankan dengan opsi *Run without RLS*.
>
> **Kenapa aman sekarang:** `anon key` tidak dipakai di mana pun. Browser tidak pernah menyentuh Supabase langsung — semua lewat endpoint API kita, yang memakai `service_role` di server. Tanpa jalur `anon`, tidak ada yang bisa diakses tanpa izin meski RLS mati.
>
> **Kapan ini WAJIB dinyalakan:** begitu `NEXT_PUBLIC_SUPABASE_ANON_KEY` dipakai di kode browser — entah untuk Realtime atau untuk query langsung dari FE. Saat itu RLS bukan lagi opsional; tanpa policy, siapa pun yang membuka DevTools bisa membaca dan menghapus seluruh tabel.
>
> **Dampak ke demo:** tidak ada yang hilang. Dua browser tetap update bersamaan, bedanya hanya jeda 2–3 detik. Proses baseline/verifikasi sendiri makan 10–20 detik memanggil AI, jadi jeda itu tidak terlihat.

SQL di bawah ini **belum dijalankan** — simpan untuk nanti kalau Realtime jadi dipakai:

```sql
alter table jobs        enable row level security;
alter table oracle_runs enable row level security;
alter table activity    enable row level security;

create policy "public read jobs"        on jobs        for select to anon, authenticated using (true);
create policy "public read oracle_runs" on oracle_runs for select to anon, authenticated using (true);
create policy "public read activity"    on activity    for select to anon, authenticated using (true);
-- Tidak ada policy insert/update/delete → anon tidak bisa menulis apa pun.

-- Aktifkan Realtime
alter publication supabase_realtime add table jobs;
alter publication supabase_realtime add table oracle_runs;
alter publication supabase_realtime add table activity;
```

> **Cek keamanan kalau SQL di atas jadi dijalankan:** buka Supabase → Table Editor. Tiap tabel harus bertanda "RLS enabled". Kalau ada tabel tanpa RLS sementara anon key sudah dipakai di FE, siapa pun bisa menghapus seluruh data kalian.

## 3.4 Cara FE membaca data

### Yang dipakai sekarang — polling

```ts
// Di komponen FE yang butuh terasa "hidup" (radar sitasi, status job)
useEffect(() => {
  const id = setInterval(() => refetch(), 3000);
  return () => clearInterval(id);
}, []);
```

Tidak butuh `anon key`, tidak butuh RLS, tidak ada koneksi yang perlu dikelola. Semua lewat endpoint `GET /api/...` yang sudah ada.

### Alternatif kalau nanti ada waktu — Realtime (belum dipakai)

Butuh §3.3 dijalankan lebih dulu.

```ts
// lib/realtime.ts — dipakai di FE, memakai ANON key (aman terekspos)
import { createClient } from '@supabase/supabase-js';

export const supabasePublic = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export function subscribeJob(jobId: number, onChange: () => void) {
  return supabasePublic
    .channel(`job-${jobId}`)
    .on('postgres_changes',
        { event: '*', schema: 'public', table: 'jobs', filter: `job_id=eq.${jobId}` },
        onChange)
    .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'oracle_runs', filter: `job_id=eq.${jobId}` },
        onChange)
    .subscribe();
}
```

Kalau ini jadi dipakai, ia menggantikan blok `setInterval` di atas.

---

# BAGIAN 4 — Aturan Kanonik

Empat fungsi ini adalah **kontrak matematis** antara FE, BE, dan blockchain. Kalau salah satu pihak menghitungnya berbeda satu karakter saja, verifikasi akan selalu gagal dan kalian akan menghabiskan berjam-jam mencari penyebabnya.

## 4.1 Query pool hash

Roadmap v1 memakai `JSON.stringify({queries, targetCount, multiEngine})`. Itu rapuh: urutan properti objek menentukan hasil, dan `brand` tidak ikut ter-hash — padahal `brand` menentukan apa yang dicari Oracle.

```ts
// lib/hash.ts
import { keccak256, toHex } from 'viem';

const SEP = '\n';

/**
 * Tolak nilai yang bisa merusak kanonikalisasi.
 *
 * Karena '\n' yang memisahkan field, tidak ada NILAI field yang boleh
 * mengandungnya — kalau boleh, dua input berbeda bisa menghasilkan string
 * kanonik yang sama. Hash-nya bentrok, dan karena queryPoolHash adalah
 * GERBANG KEASLIAN data (§5.3), gerbangnya bisa ditembus. Ini batas
 * keamanan, bukan sekadar kerapian.
 *
 * \r ikut ditolak: file dari Windows bisa menyelipkannya, dan "abc\r"
 * vs "abc" menghasilkan hash berbeda secara tak terduga.
 */
export function assertCanonicalSafe(value: string, field: string): void {
  if (value.includes(SEP)) throw new Error(`${field} tidak boleh mengandung baris baru`);
  if (value.includes('\r')) throw new Error(`${field} tidak boleh mengandung carriage return`);
}

export interface QueryPoolInput {
  brand: string;
  queries: string[];
  targetCount: number;
  multiEngine: boolean;
}

/** String kanonik. Urutan & format dikunci eksplisit — tidak bergantung
 *  pada urutan properti objek seperti JSON.stringify. */
export function canonicalQueryPool(i: QueryPoolInput): string {
  const brand = i.brand.trim();
  const queries = i.queries.map((q) => q.trim());

  // brand WAJIB ikut diperiksa — ia juga masuk ke string kanonik.
  assertCanonicalSafe(brand, 'Nama brand');
  queries.forEach((q, idx) => assertCanonicalSafe(q, `Pertanyaan #${idx + 1}`));

  if (!brand) throw new Error('Nama brand tidak boleh kosong');
  if (!Number.isInteger(i.targetCount)) {
    throw new Error('targetCount harus bilangan bulat');
  }

  return [
    'GEOv1',                       // versi skema — kalau format berubah, naikkan ini
    brand,
    String(i.targetCount),
    i.multiEngine ? '1' : '0',
    String(queries.length),
    ...queries,
  ].join('\n');
}

export function queryPoolHash(i: QueryPoolInput): `0x${string}` {
  return keccak256(toHex(canonicalQueryPool(i)));
}

export function contentHash(content: string): `0x${string}` {
  return keccak256(toHex(content));
}
```

**Untuk orang blockchain:** kontrak **tidak perlu menghitung hash ini**. Ia hanya menyimpan `bytes32` yang dikirim client di `createJob`. Backend yang memverifikasi dengan menghitung ulang dari data DB dan membandingkan dengan nilai on-chain. Ini menghindari kerumitan encoding string di Solidity sepenuhnya.

## 4.2 VRF subset — deterministik dari seed on-chain

```ts
// lib/vrf.ts
import { keccak256, concatHex, toHex } from 'viem';

/** Ukuran subset: sama dengan prototipe — max(3, ceil(n * 0.7)). */
export function subsetSize(n: number): number {
  return Math.min(n, Math.max(3, Math.ceil(n * 0.7)));
}

/**
 * Fisher-Yates dengan PRNG deterministik yang diturunkan dari seed on-chain.
 * Siapa pun yang tahu seed + n + k bisa menghitung subset yang sama persis
 * → Oracle tidak bisa curang memilih pertanyaan yang menguntungkan.
 */
export function deriveSubset(seed: `0x${string}`, n: number, k: number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const h = keccak256(concatHex([seed, toHex(i, { size: 32 })]));
    const j = Number(BigInt(h) % BigInt(i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, Math.min(k, n)).sort((a, b) => a - b);
}
```

> **Catatan jujur:** `block.prevrandao` bukan VRF sekelas Chainlink — validator punya pengaruh terbatas terhadapnya. Tapi ini **jauh** lebih baik daripada `Math.random()` di server Oracle, karena hasilnya bisa diverifikasi ulang oleh siapa pun. Sebutkan batasan ini di depan juri; kejujuran teknis itu nilai plus, bukan minus.
>
> Kalau `n = 3`, `subsetSize` = 3 = semua pertanyaan, jadi VRF tidak berpengaruh. Itu wajar dan bukan bug.

## 4.3 Keputusan — aritmetika integer murni

```ts
// lib/scoring.ts
export type Decision = 'release' | 'refund' | 'dispute';

/**
 * Ekuivalen persis dengan logika prototipe, tanpa float dan tanpa epsilon:
 *
 *   prototipe : score >= ceil((target/n)*of - 0.001)   → release
 *               score <= (target/n)*of - 2             → refund
 *
 *   di sini   : score*n >= target*of                   → release
 *               score*n <= target*of - 2n              → refund
 *
 * Kalikan silang dengan n (selalu positif) — hasilnya identik untuk semua
 * kasus batas, tapi bisa dihitung ulang oleh pihak lain (termasuk kontrak)
 * tanpa risiko selisih pembulatan.
 */
export function decide(args: {
  score: number;   // jumlah hit di subset
  of: number;      // ukuran subset
  target: number;  // target_count job
  n: number;       // total pertanyaan di pool
}): Decision {
  const { score, of, target, n } = args;
  if (n <= 0) throw new Error('decide(): n harus lebih besar dari 0');
  if (score * n >= target * of) return 'release';
  if (score * n <= target * of - 2 * n) return 'refund';
  return 'dispute';
}

/** Hanya untuk ditampilkan ke user, jangan dipakai untuk memutuskan. */
export function scaledTarget(target: number, of: number, n: number): number {
  return (target / n) * of;
}
```

**Verifikasi manual** (target 3 dari 5 pertanyaan, subset 4):

| score | `score*n` | `target*of` | `target*of - 2n` | hasil |
|---|---|---|---|---|
| 0 | 0 | 12 | 2 | refund |
| 1 | 5 | 12 | 2 | dispute |
| 2 | 10 | 12 | 2 | dispute |
| 3 | 15 | 12 | 2 | release |

Sama persis dengan prototipe. ✓

## 4.4 Verdict — objek yang bisa diaudit

Inilah yang membuat klaim "trustless karena diukur, bukan diklaim" bisa dibuktikan.

```ts
// lib/verdict.ts
import { keccak256, toHex } from 'viem';
import type { Decision } from './scoring';

export interface Verdict {
  v: 'GEOv1';
  jobId: number;
  brand: string;
  seed: string;
  subset: number[];
  hits: number[];          // 0/1 per elemen subset, urutan sama
  score: number;
  of: number;
  target: number;
  n: number;
  multiEngine: boolean;
  decision: Decision;
}

/** Kanonikalisasi eksplisit — tidak bergantung urutan properti objek. */
export function canonicalVerdict(v: Verdict): string {
  return [
    v.v, String(v.jobId), v.brand, v.seed,
    v.subset.join(','), v.hits.join(','),
    String(v.score), String(v.of), String(v.target), String(v.n),
    v.multiEngine ? '1' : '0', v.decision,
  ].join('\n');
}

export function verdictHash(v: Verdict): `0x${string}` {
  return keccak256(toHex(canonicalVerdict(v)));
}
```

Alurnya: backend menghitung `verdictHash` → kirim ke kontrak lewat `settleRelease(jobId, verdictHash)` → simpan `verdict_json` lengkap di DB → siapa pun ambil `GET /api/jobs/:id/verdict`, hitung ulang hash-nya, cocokkan dengan yang di blockchain. **Kalau Oracle memalsukan hasil, ketahuan.**

---

# BAGIAN 5 — Kontrak API

Semua respons memakai amplop yang sama.

**Sukses:** `{ "ok": true, ...data }` · **Gagal:** `{ "ok": false, "error": "pesan", "code": "SLUG" }`

## 5.1 Endpoint baca (publik, tanpa auth)

| Method | Path | Query | Respons | Dipakai halaman |
|---|---|---|---|---|
| GET | `/api/jobs` | `filter`, `wallet`, `page`, `limit` | `{ jobs, total, page, limit }` | Pasar, Ringkasan, Kontrak Saya |
| GET | `/api/jobs/:id` | `include=runs,activity` | `{ job, runs?, activity? }` | Detail Kontrak |
| GET | `/api/jobs/:id/oracle-log` | — | `{ runs }` | Tab log di detail |
| GET | `/api/jobs/:id/verdict` | — | `{ verdict, verdictHash, onChainHash, matches }` | Audit |
| GET | `/api/oracle-log` | `jobId`, `phase`, `limit` | `{ runs }` | **Log Oracle (global)** |
| GET | `/api/activity` | `jobId`, `limit` | `{ activity }` | Aktivitas |
| GET | `/api/stats` | `wallet` | `{ asClient, asFreelancer, needJury, done }` | Ringkasan |
| GET | `/api/chain-info` | — | `{ oracle, arbiter, owner, bondBps, … }` | Gerbang panel juri |

> Dua yang tidak ada di dokumen lama: `/api/oracle-log` global (halaman Log Oracle di prototipe menampilkan **semua** job, bukan satu) dan `?include=` (radar di halaman detail butuh `runs`; tanpa ini FE harus dua kali request).

## 5.2 Endpoint tulis

| Method | Path | Gerbang | Fungsi |
|---|---|---|---|
| POST | `/api/jobs` | **hash-gated** | Simpan metadata → antrikan baseline |
| POST | `/api/jobs/:id/deliverable` | **hash-gated** | Simpan konten (draft, sebelum tx) |
| POST | `/api/jobs/:id/baseline` | `CRON_SECRET` / internal | Jalankan/lanjutkan baseline (resumable) |
| POST | `/api/jobs/:id/verify` | rate-limit + status guard | VRF → AI → settle on-chain |
| POST | `/api/sync/:id` | rate-limit | Sinkronkan satu job dari chain (dipanggil FE setelah tx) |
| GET | `/api/indexer/poll` | `CRON_SECRET` | Cron cadangan |

## 5.3 Gerbang hash-gated — cara kerjanya

Tidak ada login, tidak ada popup tanda tangan. Backend menerima data **hanya jika hash-nya cocok dengan yang sudah tercatat di blockchain.**

```
1. FE hitung  h = queryPoolHash({brand, queries, targetCount, multiEngine})
2. FE kirim   createJob(h, acceptDeadline) { value: budget }   ← tx wallet user
3. FE POST    /api/jobs  { jobId, brand, queries, targetCount, multiEngine, ... }
4. BE hitung ulang h' dari body
5. BE baca    getJob(jobId).queryPoolHash dari chain
6. h' === on-chain ?  simpan  :  tolak 400
```

Kenapa ini aman: penyerang tidak bisa memasukkan data palsu, karena hash datanya tidak akan cocok dengan yang sudah terkunci di blockchain. Dan mereka tidak bisa mengubah yang di blockchain tanpa membayar budget dari wallet mereka sendiri.

**Batasnya, dan ini harus kamu sadari:** `brief` tidak ikut ter-hash (murni kosmetik, tidak memengaruhi penilaian Oracle), dan siapa pun yang tahu data aslinya bisa mengirimkannya duluan. Yang kedua tidak merugikan — datanya toh identik. Kalau nanti ingin lebih ketat, tambahkan tanda tangan wallet; strukturnya sudah siap menerima itu.

## 5.4 Kode error

| Code | HTTP | Arti |
|---|---|---|
| `VALIDATION` | 400 | Input tidak lolos validasi |
| `HASH_MISMATCH` | 400 | Hash tidak cocok dengan on-chain |
| `NOT_FOUND` | 404 | Job tidak ada |
| `WRONG_STATUS` | 409 | Aksi tidak valid untuk status sekarang |
| `BUSY` | 409 | Worker lain sedang memproses job ini |
| `STRUCTURAL_FAILED` | 422 | Konten terlalu pendek / tidak menyebut brand |
| `RATE_LIMITED` | 429 | Terlalu sering |
| `ORACLE_FAILED` | 502 | Provider AI error |
| `CHAIN_FAILED` | 502 | Transaksi on-chain gagal |
| `INTERNAL` | 500 | Lainnya |

---

# BAGIAN 6 — Implementasi, Fase demi Fase

## FASE 0 — Fondasi (≈1 jam)

**Tujuan:** semua helper dasar siap, sehingga tiap route setelah ini bisa pendek dan seragam.

### 0.1 Install

```bash
npm install @supabase/supabase-js viem
```

(`@anthropic-ai/sdk` menyusul di Fase 4 — belum dibutuhkan selama pakai mock.)

### 0.2 Naikkan target TypeScript ke ES2020

`create-next-app` memberi `"target": "ES2017"` di `tsconfig.json`. Ubah jadi:

```json
"target": "ES2020",
```

**Kenapa wajib:** seluruh perhitungan uang di proyek ini memakai `BigInt` (§3.1). Literal BigInt — `20n`, `100n` — **ditolak compiler** di bawah ES2020:

```
error TS2737: BigInt literals are not available when targeting lower than ES2020
```

Aman diubah: `noEmit: true`, jadi `target` hanya menentukan fitur bahasa yang boleh dipakai. Transpilasi sebenarnya dikerjakan SWC/Turbopack dengan target sendiri.

### 0.3 `.env.local`

```bash
# --- Supabase (Fase 1) ---
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# --- Oracle (Fase 4) ---
ORACLE_PROVIDER=mock            # mock | claude
ANTHROPIC_API_KEY=

# --- Blockchain (Fase 9) ---
CHAIN_ENABLED=false
RPC_URL=https://bsc-testnet-rpc.publicnode.com
GEO_ESCROW_ADDRESS=0x41462F3092Ca66b7B3d9c8b20337793e2756cC46
ORACLE_PRIVATE_KEY=

# --- Operasional ---
CRON_SECRET=ganti-dengan-string-acak-panjang
```

> Pastikan `.env.local` ada di `.gitignore` (default Next.js sudah). Variabel tanpa `NEXT_PUBLIC_` **tidak pernah** sampai ke browser — itulah yang melindungi private key Oracle.

### 0.4 `lib/env.ts`

```ts
function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} belum diisi di .env.local`);
  return v;
}

export const env = {
  get supabaseUrl()        { return req('SUPABASE_URL'); },
  get supabaseServiceKey() { return req('SUPABASE_SERVICE_ROLE_KEY'); },

  oracleProvider: (process.env.ORACLE_PROVIDER ?? 'mock') as 'mock' | 'claude',
  get anthropicKey() { return req('ANTHROPIC_API_KEY'); },

  chainEnabled: process.env.CHAIN_ENABLED === 'true',
  get rpcUrl()          { return req('RPC_URL'); },
  get escrowAddress()   { return req('GEO_ESCROW_ADDRESS'); },
  get oraclePrivateKey(){ return req('ORACLE_PRIVATE_KEY'); },

  cronSecret: process.env.CRON_SECRET ?? '',
};
```

> Kenapa **getter**, bukan konstanta yang dicek saat import: kalau dicek saat import, `next build` akan gagal di lingkungan yang belum punya semua variabel. Dengan getter, error baru muncul saat variabelnya benar-benar dipakai — dan pesannya menyebut nama variabel yang mana.

### 0.5 `lib/http.ts`

```ts
import { NextResponse } from 'next/server';

export type ErrorCode =
  | 'VALIDATION' | 'HASH_MISMATCH' | 'NOT_FOUND' | 'WRONG_STATUS'
  | 'BUSY' | 'STRUCTURAL_FAILED' | 'RATE_LIMITED'
  | 'ORACLE_FAILED' | 'CHAIN_FAILED' | 'INTERNAL';

const HTTP: Record<ErrorCode, number> = {
  VALIDATION: 400, HASH_MISMATCH: 400, NOT_FOUND: 404, WRONG_STATUS: 409,
  BUSY: 409, STRUCTURAL_FAILED: 422, RATE_LIMITED: 429,
  ORACLE_FAILED: 502, CHAIN_FAILED: 502, INTERNAL: 500,
};

export function ok<T extends object>(data: T) {
  return NextResponse.json({ ok: true, ...data });
}

export function fail(code: ErrorCode, error: string) {
  return NextResponse.json({ ok: false, code, error }, { status: HTTP[code] });
}

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string) { super(message); }
}

/** Bungkus tiap handler — mengubah throw jadi respons rapi, dan mencegah
 *  detail internal (stack trace, pesan Postgres) bocor ke client. */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<Response>
) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.code, e.message);
      console.error('[api] unhandled', e);
      return fail('INTERNAL', 'Terjadi kesalahan internal');
    }
  };
}
```

**Selesai kalau:** `npm run dev` jalan tanpa error, dan `/api/hello` masih membalas JSON.

---

## FASE 1 — Database (≈45 menit)

### Langkah

1. `supabase.com` → **New Project**. Region **Singapore**. Simpan password database.
2. **SQL Editor** → paste seluruh SQL dari §3.2 → **Run**. Muncul dialog peringatan RLS → pilih **"Run without RLS"** (lihat §3.3 kenapa ini aman).
3. **Table Editor** → pastikan ada 4 tabel: `jobs`, `oracle_runs`, `activity`, `indexer_state`.
4. **Project Settings → API** → salin ke `.env.local`:
   - Project URL → `SUPABASE_URL`
   - **Secret key** (atau tab *Legacy* → `service_role`) → `SUPABASE_SERVICE_ROLE_KEY`
   - Baris `NEXT_PUBLIC_SUPABASE_*` **biarkan kosong** — baru diisi kalau Realtime jadi dipakai

> Supabase mengganti istilah key-nya: **Publishable key** = `anon` lama, **Secret keys** = `service_role` lama. Dua-duanya berfungsi; yang kita butuh adalah yang **secret**.

> **`service_role` vs `anon`:** `anon` dibatasi RLS dan aman terekspos di browser — tapi **kita tidak memakainya sama sekali** (lihat §3.3: FE mengakses data lewat endpoint API kita, bukan langsung ke Supabase). `service_role` melewati RLS sepenuhnya (admin penuh) dan **hanya boleh di server**. Karena itu ia tidak berawalan `NEXT_PUBLIC_`. Kalau `service_role` bocor ke browser, siapa pun bisa menghapus seluruh database kalian.

### `lib/db.ts`

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let _db: SupabaseClient | null = null;

/** Lazy singleton — tidak menyentuh env sampai benar-benar dipakai,
 *  supaya `next build` tidak gagal di mesin tanpa .env.local lengkap. */
export function db(): SupabaseClient {
  if (!_db) {
    _db = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { persistSession: false },
    });
  }
  return _db;
}
```

### Tes koneksi

Ganti isi `app/api/hello/route.ts`:

```ts
import { db } from '@/lib/db';
import { ok, fail } from '@/lib/http';

export async function GET() {
  const { error, count } = await db()
    .from('jobs').select('*', { count: 'exact', head: true });
  if (error) return fail('INTERNAL', error.message);
  return ok({ jobs: count });
}
```

**Selesai kalau:** `/api/hello` membalas `{"ok":true,"jobs":0}`.

---

## FASE 2 — Lapisan Murni (≈1,5 jam)

**Tujuan:** semua logika bisnis yang tidak butuh database, jaringan, atau AI — jadi bisa dites instan.

**Kenapa duluan:** ini fondasi kebenaran sistem. Kalau `decide()` salah, seluruh escrow salah. Diuji di sini, murah; ketahuan di Fase 8, mahal.

Buat file-file ini persis seperti di Bagian 2 & 4:

- `lib/types.ts` (di bawah)
- `lib/status.ts` → §2.4
- `lib/hash.ts` → §4.1
- `lib/vrf.ts` → §4.2
- `lib/scoring.ts` → §4.3
- `lib/verdict.ts` → §4.4
- `lib/format.ts` (di bawah)

### `lib/types.ts`

```ts
export type JobStatus =
  | 'Open' | 'Accepted' | 'Submitted' | 'Verifying'
  | 'Disputed' | 'ReleasedFull' | 'Refunded';

export type JobState =
  | 'idle' | 'queued_baseline' | 'running_baseline'
  | 'running_structural' | 'queued_verify' | 'running_verify' | 'error';

export interface Job {
  job_id: number;
  client_addr: string;
  freelancer_addr: string | null;
  // arbiter_addr DIHAPUS (migrasi 01) -- arbiter adalah nilai
  // tingkat-kontrak, bukan properti per-job. Lihat GET /api/chain-info.

  brand: string;
  brief: string | null;
  queries: string[];
  target_count: number;
  multi_engine: boolean;
  query_pool_hash: string;

  // Semua wei adalah STRING — pakai BigInt(x) untuk berhitung.
  budget_wei: string;
  bond_wei: string | null;
  structural_released_wei: string;

  deliverable_content: string | null;
  deliverable_hash: string | null;
  deliverable_submitted_at: string | null;

  baseline_score: number | null;
  baseline_of: number | null;
  baseline_at: string | null;

  verification_seed: string | null;
  verification_subset: number[] | null;
  verification_score: number | null;
  verification_of: number | null;
  verification_decision: 'release' | 'refund' | 'dispute' | null;
  verification_at: string | null;
  verdict_hash: string | null;
  verdict_json: unknown | null;

  status: JobStatus;
  job_state: JobState;
  job_state_at: string;
  settled_by: 'oracle' | 'arbiter' | null;
  last_error: string | null;

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
```

### `lib/format.ts`

```ts
import { formatEther, parseEther } from 'viem';

/** Port dari fmtTBNB() di prototipe, tapi memakai formatEther milik viem
 *  agar tidak kehilangan presisi (Number(wei)/1e18 tidak aman). */
export function formatTBNB(wei: string | bigint): string {
  const s = formatEther(typeof wei === 'string' ? BigInt(wei) : wei);
  const trimmed = s.includes('.')
    ? s.replace(/0+$/, '').replace(/\.$/, '')
    : s;
  return (trimmed === '' || trimmed === '-0' ? '0' : trimmed) + ' tBNB';
}

export function toWei(tbnb: string | number): string {
  return parseEther(String(tbnb)).toString();
}

export function shortAddr(a: string | null): string {
  if (!a) return '';
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}
```

### Verifikasi (`scripts/check-pure.ts`)

```bash
npm install -D tsx     # runner TypeScript; Node ESM butuh ekstensi
                       # eksplisit di impor relatif, tsx tidak
npm run check          # -> "tsx scripts/check-pure.ts"
```

Skrip lengkapnya ada di repo. Yang diuji, 68 pemeriksaan:

| Kelompok | Isi |
|---|---|
| `decide` — tabel batas | 5 kasus dari tabel verifikasi §4.3 |
| `decide` — **kesetaraan exhaustive** | **255 kombinasi** (n 3–6 × target 1–n × of 3–n × score 0–of) dibandingkan satu per satu dengan rumus float prototipe. Ini yang membuktikan rumus integer benar-benar setara, bukan sekadar "mirip" |
| `vrf` | determinisme, rentang, keterurutan, tanpa duplikat, n=0, dan sebaran 200 seed menjangkau semua indeks |
| `hash` | stabilitas, kepekaan tiap field, format keccak256 |
| `hash` — **penjaga keamanan** | newline/CR di brand & query ditolak; brand kosong ditolak; CR di ujung dinormalkan `trim()` |
| `verdict` | stabilitas + kepekaan terhadap score, subset, hits, decision, seed |
| `format` | presisi wei bolak-balik, `"10"` tidak terpangkas jadi `"1"` |
| `status` | ke-13 cabang `deriveUiStatus`, dan status gagal tidak pernah `spin` |

**Selesai kalau:** `npm run check` menutup dengan **`gagal: 0`** pada kedua berkas uji, dan `npx tsc --noEmit` bersih.

> Jumlah uji sengaja tidak dipatok angka di sini: tiap fase berikutnya menambah uji baru, jadi angka mati akan cepat basi. Yang wajib nol adalah **kegagalannya**.

---

## FASE 3 — Repository + Seed + Endpoint Baca (≈3 jam)

### 3.1 `lib/validate.ts` — **wajib ditulis duluan**

> **Ini menutup lubang keamanan nyata.** Filter PostgREST berupa **string** yang di-parse di server (`"client_addr.eq.0x11,freelancer_addr.eq.0x11"`). Supabase **tidak** mem-parameterkan bagian ini. Kalau nilai `wallet` dari query string langsung diinterpolasi ke situ, penyerang bisa menyuntikkan sintaks filter.
>
> Sudah dibuktikan di project ini terhadap data seed:
>
> | `?wallet=` | Hasil |
> |---|---|
> | `0x1111…` (normal) | job `[1,3,5]` — benar, milik client A |
> | `0x1111…,status.eq.Open` | job `[1,2,3,5]` — job 2 bocor |
> | `0x1111…,job_id.gte.0` | job `[1,2,3,4,5,6]` — **filter dilewati total** |
>
> Dipakai di `GET /api/jobs` **dan** `GET /api/stats` — keduanya memakai `.or()`.

```ts
import { ApiError } from './http';

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/** Setelah lolos ini, nilainya dijamin cuma [0-9a-f] -> aman diinterpolasi. */
export function parseAddress(
  raw: string | null | undefined,
  field = 'wallet'
): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const v = raw.trim().toLowerCase();
  if (!ADDRESS_RE.test(v)) {
    throw new ApiError('VALIDATION', `${field} bukan alamat yang valid`);
  }
  return v;
}

/**
 * Number('abc') = NaN, dan NaN LOLOS begitu saja lewat Math.max/Math.min --
 * lalu meledak jauh di dalam .range(NaN, NaN) sebagai error 500 yang
 * membingungkan. Ditangkap di sini.
 */
export function parseIntParam(
  raw: string | null | undefined,
  { def, min, max }: { def: number; min: number; max: number }
): number {
  if (raw === null || raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** job_id bigint di DB -- tolak yang bukan angka, jangan biarkan jadi 500. */
export function parseJobId(raw: string): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    throw new ApiError('VALIDATION', 'jobId tidak valid');
  }
  return n;
}
```

`requireAddress()` (untuk alamat di body request, dipakai Fase 6) ada di file repo.

**Aturan pakai:** setiap nilai yang berasal dari `searchParams` atau body request harus lewat salah satu fungsi di atas **sebelum** menyentuh query. Tidak ada pengecualian.

### 3.2 `lib/jobs-repo.ts`

Semua akses database lewat sini. Route tetap pendek dan tidak ada query yang ditulis dua kali.

```ts
import { db } from './db';
import { ApiError } from './http';
import { MARKET_FILTERS } from './status';
import type { Job, OracleRun, ActivityEntry, JobState } from './types';

export async function getJob(jobId: number | string): Promise<Job> {
  const { data, error } = await db()
    .from('jobs').select('*').eq('job_id', jobId).single();
  if (error || !data) throw new ApiError('NOT_FOUND', 'Job tidak ditemukan');
  return data as Job;
}

export async function listJobs(opts: {
  filter?: keyof typeof MARKET_FILTERS;
  wallet?: string;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(1, opts.limit ?? 20));

  let q = db()
    .from('jobs')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range((page - 1) * limit, page * limit - 1);

  const statuses = opts.filter ? MARKET_FILTERS[opts.filter] : null;
  if (statuses) q = q.in('status', statuses);

  if (opts.wallet) {
    // Aman diinterpolasi HANYA karena parseAddress() (§3.1) sudah memastikan
    // nilainya cocok /^0x[0-9a-f]{40}$/ -- tidak ada koma/kurung/titik yang
    // bisa mengubah arti filter PostgREST. JANGAN panggil ini dengan nilai
    // mentah dari searchParams.
    q = q.or(`client_addr.eq.${opts.wallet},freelancer_addr.eq.${opts.wallet}`);
  }

  const { data, error, count } = await q;
  if (error) throw new ApiError('INTERNAL', error.message);
  return { jobs: (data ?? []) as Job[], total: count ?? 0, page, limit };
}

export async function getRuns(jobId: number | string, phase?: string) {
  let q = db().from('oracle_runs').select('*').eq('job_id', jobId)
    .order('query_index', { ascending: true })
    .order('created_at', { ascending: true });
  if (phase) q = q.eq('phase', phase);
  const { data, error } = await q;
  if (error) throw new ApiError('INTERNAL', error.message);
  return (data ?? []) as OracleRun[];
}

export async function getActivity(jobId?: number | string, limit = 150) {
  let q = db().from('activity').select('*')
    .order('block_number', { ascending: false })
    .order('log_index', { ascending: false })
    .limit(Math.min(300, limit));
  if (jobId) q = q.eq('job_id', jobId);
  const { data, error } = await q;
  if (error) throw new ApiError('INTERNAL', error.message);
  return (data ?? []) as ActivityEntry[];
}

/**
 * Lock atomik. Update bersyarat pada job_state:
 * hanya berhasil kalau state saat ini masih `from`.
 * Kalau dua request datang bersamaan, hanya satu yang dapat baris —
 * yang kedua mendapat 0 baris dan ditolak.
 */
export async function acquireLock(
  jobId: number | string, from: JobState[], to: JobState
): Promise<boolean> {
  const { data, error } = await db()
    .from('jobs')
    .update({ job_state: to, job_state_at: new Date().toISOString() })
    .eq('job_id', jobId)
    .in('job_state', from)
    .select('job_id');
  if (error) throw new ApiError('INTERNAL', error.message);
  return (data ?? []).length > 0;
}

export async function releaseLock(
  jobId: number | string, to: JobState = 'idle', lastError?: string
) {
  await db().from('jobs').update({
    job_state: to,
    job_state_at: new Date().toISOString(),
    last_error: lastError ?? null,
  }).eq('job_id', jobId);
}
```

> **Kenapa lock-nya begini, bukan "baca dulu lalu tulis":** roadmap v1 membaca `job_state`, mengecek, lalu menulis. Di antara baca dan tulis ada celah — dua request bisa sama-sama membaca `'idle'` dan sama-sama melanjutkan. `UPDATE ... WHERE job_state IN (...)` adalah satu operasi atomik di Postgres, jadi celahnya tidak ada.

### 3.3 Seed data

`app/api/dev/seed/route.ts` — **hanya jalan di development.**

```ts
import { db } from '@/lib/db';
import { queryPoolHash } from '@/lib/hash';
import { toWei } from '@/lib/format';
import { ok, fail, handler } from '@/lib/http';

export const POST = handler(async () => {
  if (process.env.NODE_ENV === 'production') {
    return fail('VALIDATION', 'Seed hanya tersedia di development');
  }

  const seeds = [
    {
      job_id: 1,
      brand: 'Root & Bloom',
      brief: 'Skincare organik lokal asal Bandung.',
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
      client: '0x1111111111111111111111111111111111111111',
      status: 'Open' as const,
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
      client: '0x2222222222222222222222222222222222222222',
      status: 'Open' as const,
    },
  ];

  for (const s of seeds) {
    await db().from('jobs').upsert({
      job_id: s.job_id,
      client_addr: s.client,
      brand: s.brand,
      brief: s.brief,
      queries: s.queries,
      target_count: s.target_count,
      multi_engine: s.multi_engine,
      query_pool_hash: queryPoolHash({
        brand: s.brand, queries: s.queries,
        targetCount: s.target_count, multiEngine: s.multi_engine,
      }),
      budget_wei: toWei(s.budget),
      status: s.status,
      job_state: 'idle',
      accept_deadline: new Date(Date.now() + 7 * 864e5).toISOString(),
    });
  }

  return ok({ seeded: seeds.length });
});
```

### 3.4 Endpoint baca

`app/api/jobs/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { listJobs } from '@/lib/jobs-repo';
import { MARKET_FILTERS } from '@/lib/status';
import { ok, handler } from '@/lib/http';

export const GET = handler(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const raw = p.get('filter');
  const filter = raw && raw in MARKET_FILTERS
    ? (raw as keyof typeof MARKET_FILTERS)
    : undefined;

  const result = await listJobs({
    filter,
    wallet: p.get('wallet') ?? undefined,
    page: Number(p.get('page') ?? 1),
    limit: Number(p.get('limit') ?? 20),
  });
  return ok(result);
});
```

`app/api/jobs/[id]/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { getJob, getRuns, getActivity } from '@/lib/jobs-repo';
import { ok, handler } from '@/lib/http';

export const GET = handler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  // Next.js 16: params adalah Promise, WAJIB di-await.
  const { id } = await params;
  const include = (req.nextUrl.searchParams.get('include') ?? '').split(',');

  const job = await getJob(id);
  return ok({
    job,
    runs:     include.includes('runs')     ? await getRuns(id)     : undefined,
    activity: include.includes('activity') ? await getActivity(id) : undefined,
  });
});
```

> Alternatif yang lebih rapi di Next 16: `ctx: RouteContext<'/api/jobs/[id]'>` lalu `await ctx.params` — tipenya dibuat otomatis. Tersedia setelah `next dev` / `next build` sekali jalan.

`app/api/oracle-log/route.ts` (global — halaman Log Oracle):

```ts
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { ok, fail, handler } from '@/lib/http';

export const GET = handler(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const limit = Math.min(200, Number(p.get('limit') ?? 150));

  // Ambil brand lewat relasi supaya FE tidak perlu request kedua.
  let q = db()
    .from('oracle_runs')
    .select('*, jobs(brand)')
    .order('created_at', { ascending: false })
    .limit(limit);

  const jobId = p.get('jobId');
  const phase = p.get('phase');
  if (jobId) q = q.eq('job_id', jobId);
  if (phase) q = q.eq('phase', phase);

  const { data, error } = await q;
  if (error) return fail('INTERNAL', error.message);
  return ok({ runs: data });
});
```

`app/api/jobs/[id]/oracle-log/route.ts`, `app/api/activity/route.ts` — pola sama, panggil `getRuns` / `getActivity`.

`app/api/stats/route.ts`:

```ts
import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { ok, handler } from '@/lib/http';

function baseQuery() {
  return db().from('jobs').select('*', { count: 'exact', head: true });
}

export const GET = handler(async (req: NextRequest) => {
  // WAJIB lewat parseAddress -- endpoint ini juga memakai .or() (§3.1).
  const wallet = parseAddress(req.nextUrl.searchParams.get('wallet'));
  const zero = Promise.resolve(0);

  // Tipe diturunkan dari baseQuery(), bukan `any` -- eslint-config-next
  // menandai explicit any, dan di sini kita memang tidak membutuhkannya.
  const count = async (
    apply: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>
  ): Promise<number> => {
    const { count: c, error } = await apply(baseQuery());
    if (error) throw new ApiError('INTERNAL', error.message);
    return c ?? 0;
  };

  const [asClient, asFreelancer, needJury, done] = await Promise.all([
    wallet ? count((q) => q.eq('client_addr', wallet)) : zero,
    wallet ? count((q) => q.eq('freelancer_addr', wallet)) : zero,
    count((q) => q.eq('status', 'Disputed')),
    wallet
      ? count((q) =>
          q
            .or(`client_addr.eq.${wallet},freelancer_addr.eq.${wallet}`)
            .in('status', ['ReleasedFull', 'Refunded'])
        )
      : zero,
  ]);

  return ok({ asClient, asFreelancer, needJury, done });
});
```

> `head: true` = minta hitungannya saja, jangan kirim barisnya. `Promise.all` menjalankan keempat query bersamaan, bukan berurutan.

**Selesai kalau** seluruh baris ini benar:

| Uji | Harapan |
|---|---|
| `POST /api/dev/seed` | `{jobs:6, oracleRuns:26, activity:15}` |
| `GET /api/jobs` | `total=6` |
| `?filter=open` / `progress` / `dispute` / `done` | 2 / 2 / 1 / 1 |
| `?filter=bogus` | 400 `VALIDATION` |
| `?wallet=0x3333…` | `total=4` |
| **`?wallet=0x1111…,job_id.gte.0`** | **400 `VALIDATION`** — bukan 6 job |
| `?page=abc`, `?limit=99999`, `?page=-5` | 200, nilai jatuh ke default/klem |
| `GET /jobs/abc` | 400 `VALIDATION` |
| `GET /jobs/999` | 404 `NOT_FOUND` |
| `GET /jobs/1?include=runs,activity` | `runs` 5 baris, `budget_wei` bertipe **string** |
| `GET /jobs/1` tanpa `include` | `runs`/`activity` tidak ada di respons |
| `GET /oracle-log?limit=1` | ada `jobs:{brand}` dari relasi |
| `deriveUiStatus` atas 6 job seed | open, baseline_running, in_progress, awaiting_verify, dispute, settled_release |

---

## FASE 4 — Oracle Adapter (≈2 jam)

**Tujuan:** satu antarmuka, dua implementasi (`mock` / `claude`), dipilih lewat `ORACLE_PROVIDER`. Fase 5–8 memanggil antarmuka ini tanpa peduli providernya siapa.

> **Keputusan tim (2026-09-13): hanya Claude, Gemini dibatalkan.** Rancangan awal sempat menyiapkan Claude + Gemini supaya `multi_engine` bisa berarti dua provider sungguhan. Setelah didiskusikan tim, diputuskan cukup satu provider. Konsekuensinya permanen, bukan sementara: **`multi_engine` sekarang SELALU berarti dua persona dari model yang sama** — tidak akan pernah jadi dua mesin AI berbeda dengan konfigurasi ini. Kalau ada job `multi_engine: true`, sebut ke juri sebagai "wajib lolos di 2 gaya penjawab", **bukan** "lolos di ≥2 mesin AI" — klaim itu sudah tidak mungkin jujur.
>
> `lib/oracle/gemini.ts` dihapus dari repo (bukan sekadar tidak dipakai), `GEMINI_API_KEY` dihapus dari `.env.local`, dan `OracleProviderId` di `lib/env.ts` dipersempit jadi `'mock' | 'claude'` — kalau ada yang tidak sengaja mengetik `ORACLE_PROVIDER=gemini`, TypeScript menolaknya saat kompilasi, bukan gagal diam-diam saat runtime.

```bash
npm install @anthropic-ai/sdk
```

File: `lib/oracle/{types,prompt,mock,claude,index}.ts` — kode lengkapnya ada di repo. Bagian di bawah menjelaskan keputusan yang tidak terbaca dari kodenya.

### 4.1 Tujuh penyesuaian dari rancangan awal

> Rancangan awal berisi 8 penyesuaian dan menyertakan provider Gemini. Setelah Gemini dibatalkan (lihat catatan di atas), penyesuaian #4 (API key Gemini di query string) ikut hilang bersama filenya — sisa tujuh di bawah ini semuanya masih berlaku untuk Claude & mock.

| # | Masalah | Perbaikan |
|---|---|---|
| 1 | **Mock tidak pernah bisa menghasilkan hit saat baseline** | `brand` masuk ke `OracleRequest` |
| 2 | `max_tokens: 1000` pada Opus 5 | dinaikkan ke 4096 — token *thinking* ikut dihitung |
| 3 | `stop_reason` tidak dicek | jawaban terpotong/ditolak dilempar sebagai error |
| 4 | Tidak ada timeout | 30 detik |
| 5 | Tidak ada retry | SDK Anthropic `maxRetries: 2` (408/409/429/5xx + gangguan koneksi) |
| 6 | `enginesFor` diam-diam turun ke 1 engine | melempar `OracleError` |
| 7 | `\b` di kedua sisi `textHitsBrand` | batas kata hanya di sisi berkarakter-kata |

#### 1. Mock tidak pernah menghasilkan hit — bug paling merugikan

Rancangan awal menebak brand dari isi deliverable:

```ts
const brand = extractBrand(req.contextContent);   // regex /[A-Z][\w&'-]*.../
```

Saat **baseline**, `contextContent` memang kosong — jadi `brand` selalu `null`, mock selalu menjawab kalimat generik, dan `baseline_score` **selalu 0**. Padahal seluruh gunanya mock adalah menguji alur "baseline rendah → optimasi → verifikasi naik" tanpa memanggil AI. Dengan bug ini alur itu tidak pernah bisa diuji.

Perbaikannya: `brand` jadi field di `OracleRequest`.

> **Konsekuensi keamanan yang harus dijaga:** begitu `brand` ada di request, ia **tidak boleh** ikut masuk ke prompt yang dikirim ke AI sungguhan. Kalau AI diberi tahu brand-nya, ia cenderung menyebutnya dan seluruh pengukuran sitasi jadi tidak bermakna. Hanya `mock` yang membacanya. Ada empat uji di `scripts/check-oracle.ts` yang mengunci ini.

#### 2–3. `max_tokens` dan `stop_reason` pada Claude

Pada Opus 5 *adaptive thinking* menyala secara default, dan **token berpikir ikut dihitung ke `max_tokens`**. Dengan batas 1000, jawaban 2–4 kalimat bisa terpotong di tengah.

Yang membuatnya berbahaya: jawaban terpotong tetap berisi teks, jadi `textHitsBrand()` menilainya sebagai **"brand tidak disebut"** — skor turun karena alasan teknis, bukan karena sitasinya memang rendah. Salah ukur yang tidak meninggalkan jejak.

```ts
if (res.stop_reason === 'max_tokens') throw new OracleError('Jawaban terpotong', true);
if (res.stop_reason === 'refusal')    throw new OracleError('Ditolak model', false);
```

Lebih baik gagal terang-terangan lalu diulang (Fase 5 resumable) daripada mencatat skor palsu.

#### 4–5. Timeout dan retry

Tanpa timeout, satu permintaan menggantung menahan **seluruh** proses baseline sampai fungsi serverless mati kehabisan waktu — dan `maxDuration` cuma 60 detik untuk 4–6 query. SDK Anthropic sudah punya retry bawaan (408/409/429/5xx + gangguan koneksi), tinggal disetel `maxRetries: 2`.

#### 6. `enginesFor` tidak boleh diam-diam menurunkan mutu

```ts
// sebelum: provider 1-engine, slice(0,2) mengembalikan 1 — tanpa keluhan
return multiEngine ? all.slice(0, 2) : all.slice(0, 1);
```

Job tercatat `multi_engine: true` padahal hanya diukur satu kali, dan `verdict_json` menyatakan `multiEngine: true` — verdict-nya membohongi pembacanya. Untuk sistem yang klaim utamanya "hasilnya bisa diaudit", itu tidak bisa diterima. Sekarang melempar `OracleError`.

> Dengan hanya Claude + mock (keduanya 2 engine), penjaga ini tidak akan pernah terpicu oleh provider bawaan sekarang. Tetap dipertahankan sebagai jaring pengaman kalau nanti ada provider 1-engine ditambahkan — biayanya cuma beberapa baris kode, dan mencegah kelas bug yang sama terulang. Diuji dengan menyuntik provider palsu langsung (`enginesFor(true, fakeProvider)`), bukan lewat env — supaya tesnya tidak bergantung pada provider yang sudah dihapus.

#### 7. Batas kata `textHitsBrand`

```ts
const head = /\w/.test(b[0])            ? '\\b' : '';
const tail = /\w/.test(b[b.length - 1]) ? '\\b' : '';
```

Rancangan awal selalu memasang `\b` di kedua sisi. Untuk brand yang diawali atau diakhiri karakter non-kata — `"Acme!"`, `"&Co"` — `\b` tidak akan pernah cocok, sehingga brand itu **selamanya** dinilai tidak disebut. Regex-nya tetap valid, jadi blok `catch` pun tidak menyelamatkan. Kegagalan senyap yang akan tampak seperti "GEO-nya memang tidak berhasil".

### 4.2 Prompt

`lib/oracle/prompt.ts` — port langsung dari `callOracle()` di prototipe. **Jangan diubah tanpa alasan kuat:** mengubahnya membuat hasil baseline lama tidak sebanding dengan yang baru. Yang boleh masuk ke prompt hanya `query`, persona engine, dan (saat verifikasi) isi deliverable — **tidak pernah** nama brand.

### 4.3 Mock bukan sekadar tempelan

Deterministik: input sama → jawaban sama. Peluang menyebut brand dibuat mencerminkan premis produk — **~30% saat baseline, ~80% saat verifikasi** — sehingga alur "optimasi menaikkan sitasi" bisa diuji ujung ke ujung tanpa sekali pun memanggil AI berbayar.

Tiga gunanya: mengembangkan FE tanpa membakar kredit, demo yang hasilnya bisa diulang persis, dan rencana cadangan kalau internet di venue bermasalah.

### 4.4 Verifikasi

```bash
npm run check     # menjalankan check-pure.ts DAN check-oracle.ts
```

`scripts/check-oracle.ts` — 29 pemeriksaan, tanpa memanggil AI sungguhan:

| Kelompok | Isi |
|---|---|
| **prompt** | **4 uji bahwa brand tidak pernah bocor** ke prompt, baseline maupun verifikasi |
| `textHitsBrand` | batas kata, abai kapital, brand dengan `.`/`&`/`!`, teks & brand kosong |
| `mock` | determinisme, dan **baseline benar-benar bisa menghasilkan hit** (bug #1) |
| registry | default mock, jumlah engine, dan provider palsu 1-engine + multiEngine → `OracleError` |

**Selesai kalau:** `npm run check` menutup dengan **`gagal: 0`** pada kedua berkas uji; `npx tsc --noEmit` dan `npm run lint` bersih.


---

## FASE 5 — Baseline yang Resumable (≈2,5 jam)

**Tujuan:** ukur berapa pertanyaan yang menyebut brand **sebelum** ada optimasi (T0).

File: `lib/oracle/runner.ts`, `lib/rate-limit.ts`, `app/api/jobs/[id]/baseline/route.ts`, plus `verifyCronSecret()` di `lib/validate.ts`.

### 5.1 Tujuh penyesuaian dari rancangan awal

| # | Masalah | Sisi | Perbaikan |
|---|---|---|---|
| 1 | **Endpoint bisa dipicu siapa saja selama `baseline_score` masih null** | keamanan | tanpa secret hanya boleh saat `job_state = 'error'` |
| 2 | `CRON_SECRET` dibandingkan dengan `===` | keamanan | `timingSafeEqual` atas hash; secret kosong = ditolak |
| 3 | **Panggilan AI berurutan → job multi-engine kehabisan waktu** | performa | konkurensi terbatas 3 |
| 4 | `insert` mentah bisa bentrok dengan proses kembar | fungsionalitas | `upsert` + `ignoreDuplicates` |
| 5 | `jobId: number \| string` | fungsionalitas | `number`, lewat `parseJobId()` |
| 6 | `throw new Error('BUSY')` lalu dicocokkan lewat teks | fungsionalitas | `ApiError('BUSY', …)` |
| 7 | `hits[0]` bisa `undefined` dan terhitung "tidak disebut" | fungsionalitas | dicek eksplisit, lebih baik gagal |

#### 1. Siapa pun bisa menyuruh server menghabiskan kredit AI

Rancangan awal:

```ts
if (!authed) {
  const job = await getJob(id);
  if (job.job_state !== 'error' && job.baseline_score !== null) {
    return fail('WRONG_STATUS', 'Baseline sudah pernah diukur');
  }
}
// job dengan baseline_score = null -> LOLOS, tanpa autentikasi apa pun
```

Komentarnya menulis "jangan dibuka untuk publik", tapi logikanya melakukan persis sebaliknya: setiap job yang baseline-nya belum terukur bisa dipicu orang asing, berulang kali, dan tiap pemicuan membelanjakan kredit AI sungguhan.

Aturan sekarang:

| Pemanggil | Boleh kapan |
|---|---|
| `Authorization: Bearer <CRON_SECRET>` | selalu — jalur internal & cron |
| tanpa header | **hanya** saat `job_state = 'error'` (tombol coba-lagi) |

Kuncinya: **baseline pertama tidak pernah lewat endpoint ini.** Fase 6 memanggil `runBaseline()` langsung lewat `after()` begitu job dibuat. Jadi tidak ada alasan sah bagi publik untuk memicu pengukuran dari nol — endpoint ini murni untuk mengulang yang gagal.

#### 2. Perbandingan secret yang bocor lewat waktu

```ts
// sebelum
req.headers.get('authorization') === `Bearer ${env.cronSecret}`
```

`===` pada string berhenti di karakter pertama yang berbeda, jadi lama eksekusinya membocorkan berapa banyak prefix yang sudah benar. `verifyCronSecret()` mem-hash kedua sisi (supaya panjangnya sama) lalu membandingkan dengan `timingSafeEqual`.

Sekalian satu perbaikan yang lebih penting: **`CRON_SECRET` kosong sekarang berarti DITOLAK.** Kalau variabelnya lupa diisi saat deploy, endpoint internal harus tertutup rapat — bukan menerima siapa pun yang mengirim `Bearer ` kosong.

> **Jebakan yang benar-benar terjadi saat pengujian.** Versi pertama memakai
> `startsWith('Bearer ')` + `slice()` mentah. Satu spasi ekstra pada token --
> misalnya dari variabel klien REST yang ditulis `@cronSecret = nilai` dan tidak
> ter-trim -- membuatnya ditolak **dengan pesan yang identik** dengan "kamu memang
> tidak berwenang". Secretnya benar, tapi tidak ada satu pun petunjuk bahwa
> masalahnya cuma spasi.
>
> Sekarang memakai `/^s*Bearers+(S.*?)s*$/i`: skema tidak peka kapital
> (RFC 7235) dan spasi di sekitar token diabaikan. Ada 12 uji yang mengunci ini,
> termasuk bahwa secret salah tetap ditolak.

#### 3. Job multi-engine hampir pasti kehabisan waktu

Perkalian yang menentukan: kasus terberat **6 pertanyaan × 2 engine = 12 panggilan**. Claude Opus 5 dengan thinking realistis 3–6 detik per panggilan → **36–72 detik berurutan**, sementara `maxDuration` route adalah 60 detik.

Dengan `CONCURRENCY = 3`, 12 panggilan turun ke sekitar 20 detik. Angka 3 dipilih sebagai kompromi: cukup cepat untuk muat di `maxDuration`, cukup pelan untuk tidak memicu rate limit provider.

`mapWithLimit()` sengaja **menangkap error per item**, bukan membiarkannya langsung melempar — kalau satu panggilan gagal, pekerja lain harus tetap menyelesaikan dan menyimpan hasilnya, karena baris yang tersimpan itulah yang membuat percobaan berikutnya bisa melewatinya. Error pertama dilempar ulang setelah semua pekerja berhenti.

#### 4. Dua proses bisa menulis baris yang sama

`reclaimStaleLocks()` membebaskan lock yang menggantung lebih dari 3 menit. Kalau proses lama ternyata masih hidup, dua proses bisa menulis baris `oracle_runs` yang sama. Dengan `insert` mentah, tabrakan itu melanggar unique constraint, melempar error, dan **menggagalkan seluruh fase**. Dengan `upsert` + `ignoreDuplicates`, baris kedua cukup diabaikan.

#### 7. "Tidak diketahui" tidak boleh dihitung "tidak disebut"

```ts
// sebelum
perQuery.set(i, job.multi_engine ? hits.every(Boolean) : hits[0]);
```

`hits[0]` bisa `undefined` kalau ada yang meleset, dan `undefined` bersifat falsy — sehingga hasil yang hilang diam-diam tercatat sebagai "brand tidak disebut". Skor turun tanpa jejak. Sekarang dicek eksplisit dan melempar `ApiError` kalau ada yang tidak lengkap.

> Pola yang sama muncul tiga kali di proyek ini — jawaban terpotong (Fase 4 #2), `stop_reason` tidak dicek (Fase 4 #3), dan ini. Semuanya kelas bug yang sama: **kegagalan teknis menyamar sebagai hasil pengukuran yang sah.** Untuk sistem yang mengklaim hasilnya bisa diaudit, ini yang paling berbahaya.

### 5.2 Yang membuat baseline resumable

Kunci di database: `unique (job_id, phase, query_index, engine)` dari Fase 1.

```
1. baca oracle_runs yang sudah ada  (sekali, di awal)
2. susun daftar tugas, LEWATI yang sudah ada
3. jalankan maksimal 3 sekaligus
4. simpan tiap hasil SEGERA setelah selesai -- bukan di akhir
```

Langkah 4 yang menentukan. Kalau proses mati setelah panggilan ke-5 dari 8, lima panggilan itu sudah tersimpan; percobaan berikutnya hanya mengerjakan tiga sisanya. Tanpa itu, setiap kegagalan membuang seluruh kredit AI yang sudah dibayar.

### 5.3 Verifikasi

Unit test (`npm run check`) — 7 pemeriksaan untuk `mapWithLimit`: semua item diproses tepat sekali, konkurensi tidak melebihi batas dan benar-benar dipakai, kegagalan satu item tidak menghentikan yang lain, error dilempar ulang, daftar kosong aman.

Uji integrasi terhadap database sungguhan:

| Uji | Hasil |
|---|---|
| Tanpa secret, `job_state='idle'` | **409** `WRONG_STATUS` |
| Secret salah | ditolak (409/429, tidak pernah 200) |
| Secret benar | `{score:1, of:4, fromCache:false}` |
| `oracle_runs` setelahnya | 8 baris = 4 query × 2 engine |
| Panggil ulang | `fromCache:true`, tetap 8 baris |
| Hapus 3 baris + set `job_state='error'`, lalu retry **tanpa secret** | diizinkan, kembali 8 baris, **skor identik** |
| 3 request bersamaan | **tepat 1 sukses, 2 ditolak `BUSY`**, tanpa duplikat |

Skor yang identik setelah resume parsial itu buktinya: mock bersifat deterministik, jadi tiga baris yang di-rerun menghasilkan jawaban sama persis dengan yang dihapus.

**Selesai kalau:** `npm run check` menutup dengan **`gagal: 0`** pada kedua berkas uji; `tsc` dan `lint` bersih; dan tabel uji integrasi di atas cocok semua.


---

## FASE 6 — POST /api/jobs (≈2 jam)

**Tujuan:** terima metadata job dari FE setelah transaksi `createJob()` sukses, verifikasi keasliannya lewat hash, simpan, lalu picu baseline di latar belakang.

File: `app/api/jobs/route.ts` (POST ditambahkan ke GET yang sudah ada), `lib/validate-input.ts`, `lib/chain-server.ts`.

### 6.1 Sembilan penyesuaian dari rancangan awal

| # | Masalah | Sisi | Perbaikan |
|---|---|---|---|
| 1 | **Endpoint ini keran pengeluaran AI tanpa batas saat `CHAIN_ENABLED=false`** | keamanan | interlock produksi + rate limit dua lapis |
| 2 | `clientAddr` tidak divalidasi sama sekali | keamanan | `requireAddress()` |
| 3 | Tidak ada batas panjang teks apa pun | keamanan/biaya | `LIMITS` per field |
| 4 | `acceptDeadline` diterima mentah | fungsionalitas | wajib ISO & di masa depan |
| 5 | `jobId` lolos untuk `1.5`, `Infinity`, `> 2^53` | fungsionalitas | `Number.isSafeInteger` |
| 6 | `brief?.trim()` meledak kalau brief bukan string | fungsionalitas | `optionalText()` |
| 7 | Pertanyaan kembar diterima | fungsionalitas | ditolak |
| 8 | `multi_engine` gagal diam-diam di latar belakang | fungsionalitas | dicek saat pembuatan |
| 9 | Job nyangkut selamanya di `queued_baseline` | fungsionalitas | masuk `STUCK_STATES` |

#### 1. Keran pengeluaran AI — yang paling serius

Rangkaiannya begini: `POST /api/jobs` menerima job → `after()` memicu `runBaseline()` → `runBaseline` memanggil AI berbayar. Jadi **laju pembuatan job = laju pengeluaran AI**.

Dengan `CHAIN_ENABLED=true`, itu terbendung sendiri: penyerang harus punya job sungguhan di blockchain, yang berarti ia membayar budget dari wallet-nya. Tapi dengan `CHAIN_ENABLED=false` — mode yang kita pakai sepanjang Fase 0–8 — gerbang itu **mati total**. Siapa pun yang tahu URL-nya bisa menyuruh server kita menghabiskan kredit, gratis, tanpa batas.

Dua penahan:

```ts
// 1. Interlock mutlak: produksi tanpa verifikasi on-chain = tolak.
//    Jangan diserahkan ke kehati-hatian orang yang men-deploy.
if (env.isProduction && !env.chainEnabled) {
  return fail('WRONG_STATUS', 'CHAIN_ENABLED harus true di produksi …');
}

// 2. Rate limit DUA LAPIS
rateLimit('jobs:create:global', 500);        // longgar
rateLimit(`jobs:create:${clientAddr}`, 5000); // ketat, per wallet
```

Pembagian dua lapis itu bukan hiasan. Versi pertama saya pakai **satu** limit global 2 detik — lalu sadar saat mengujinya: kalau dua orang membuat job bersamaan di depan juri, **salah satunya ditolak** padahal keduanya sah. Sekarang lapis global sengaja longgar (hanya menahan banjir), dan lapis ketat dipasang per wallet. Diuji: wallet B tetap bisa membuat job tepat setelah wallet A kena limit.

#### 3. Batas panjang teks = batas tagihan

`queries` dikirim ke AI. Tanpa batas panjang, **penyerang yang menentukan berapa besar tagihan kita** — satu pertanyaan 50.000 karakter, dikalikan jumlah engine, dikalikan jumlah job.

| Field | Batas | Alasan |
|---|---|---|
| `brand` | 100 | tampil di UI |
| `brief` | 1.000 | tidak dikirim ke AI |
| `query` | 300 | **dikirim ke AI — ini yang menentukan biaya** |
| `deliverable` | 20.000 | dikirim ke AI sebagai konteks (Fase 7) |

#### 4–6. Input yang menyamar jadi error 500

Tiga nilai yang dulu diteruskan mentah ke database, lalu Postgres yang menolaknya — muncul sebagai **500 yang membingungkan**, bukan 400 yang menjelaskan:

- `acceptDeadline: "besok pagi"` → kolom `timestamptz` menolak
- `jobId: 1.5` → lolos `typeof === 'number'`, lalu `BigInt(1.5)` melempar
- `brief: 123` → `.trim()` bukan fungsi

Semuanya sekarang 400 dengan pesan yang menyebut field-nya.

#### 8. Gagal sekarang, bukan nanti diam-diam

Kalau `multiEngine: true` tapi provider aktif cuma punya 1 engine, dulu job tetap dibuat lalu baseline-nya gagal di latar belakang — user tidak pernah tahu kenapa. Sekarang `enginesFor(true)` dipanggil **sebelum** insert, jadi errornya muncul langsung di respons.

#### 9. Job yang nyangkut tanpa jejak

Job dibuat dengan `job_state: 'queued_baseline'`, lalu `after()` yang memulainya. Kalau proses mati **sebelum** `after()` sempat jalan, job tertinggal di `queued_baseline` — dan `reclaimStaleLocks()` hanya memungut `running_*`. Job itu tidak akan pernah diukur, tanpa pesan error apa pun.

`STUCK_STATES` sekarang mencakup `queued_baseline` dan `queued_verify`.

### 6.2 `lib/chain-server.ts` — versi sementara

Fase 6 membutuhkan `readJobFromChain()`, yang aslinya milik Fase 9. Dibuat di sini dengan jalur `CHAIN_ENABLED=false` lengkap (mengembalikan `null` → verifikasi dilewati) dan jalur on-chain melempar error yang menyebut "butuh ABI + alamat kontrak (Fase 9)".

> **`null` berarti "verifikasi dilewati", BUKAN "job tidak ada".** Pemanggil wajib memeriksa `env.chainEnabled` lebih dulu, jangan menyimpulkan dari `null` saja.

> **Sudah digantikan.** Pelemparan sementara itu tidak ada lagi — Fase 9 menggantinya dengan panggilan viem sungguhan, dan di sana `null` mendapat arti KEDUA ("job memang belum ada di kontrak"). Bagian ini dipertahankan supaya urutan pengerjaannya tetap terbaca; yang berlaku sekarang ada di §9.4.

### 6.3 Verifikasi

Unit test (`npm run check` → `scripts/check-input.ts`) — 46 pemeriksaan untuk tiap validator, termasuk kasus batas: tepat di limit diterima, lewat 1 karakter ditolak, `2^53 + 1` ditolak, kembar beda kapital ditolak.

Uji integrasi terhadap database sungguhan:

| Uji | Hasil |
|---|---|
| Jalur bahagia | 200, lalu `after()` mengisi `baseline_score` sendiri dalam ~3 detik |
| `jobId` 1.5 / negatif / 1e300 | 400 |
| `clientAddr` bukan alamat | 400 |
| brand kosong · pertanyaan 2 buah · kembar · target berlebih | 400 |
| `budgetWei` sebagai number / nol | 400 |
| query 400 karakter (batas 300) | 400 |
| deadline masa lalu / bukan tanggal / tidak dikirim | 400 |
| body bukan JSON | 400 |
| `jobId` duplikat | 400 |
| **wallet A dua kali beruntun** | kedua **`RATE_LIMITED`** |
| **wallet B tepat setelahnya** | **200** — tidak ikut terjegal |

**Selesai kalau:** `npm run check` menutup dengan **`gagal: 0`** pada ketiga berkas uji; `tsc` dan `lint` bersih; dan tabel di atas cocok semua.


---

## FASE 7 — Deliverable + Structural Check (≈2 jam)

**Tujuan:** terima hasil kerja freelancer, saring yang jelas tidak layak sebelum ia membayar gas, lalu konfirmasi ke kontrak untuk mencairkan 20%.

File: `lib/structural.ts`, `app/api/jobs/[id]/deliverable/route.ts`, `lib/flows/structural.ts`.

### 7.1 Urutan yang benar — dan kenapa

```
❌ v1 : freelancer tanda tangan tx → FE POST konten
        Tab ditutup di antaranya? Job nyangkut PERMANEN di status
        'Submitted' tanpa konten di database. Oracle tidak punya apa pun
        untuk diverifikasi, dan dananya terkunci selamanya.

✅ v2 : FE POST konten dulu → backend balas hash → baru tanda tangan tx
        Tab ditutup? Konten sudah aman. Dan structural check berjalan
        SEBELUM freelancer membayar gas — kalau ditolak, ia belum
        kehilangan apa pun.
```

### 7.2 Tujuh penyesuaian dari rancangan awal

| # | Masalah | Sisi | Perbaikan |
|---|---|---|---|
| 1 | **`releaseLock()` dipanggil tanpa memegang lock** | fungsionalitas | lock dulu, baru periksa |
| 2 | Tidak ada interlock produksi | keamanan | sama seperti Fase 6 |
| 3 | Isi deliverable tanpa batas panjang | keamanan/biaya | `LIMITS.deliverable` |
| 4 | Tidak ada rate limit | keamanan | 2 detik per job |
| 5 | `getJob(id)` / `confirmStructural(id)` menerima string | fungsionalitas | `parseJobId()` → `number` |
| 6 | Aturan structural tertanam di route | kualitas | diekstrak jadi fungsi murni |
| 7 | Structural tidak diperiksa ulang di `confirmStructural` | fungsionalitas | diperiksa lagi di dalam lock |

#### 1. Lock dilepas padahal belum pernah diambil

Rancangan awal memeriksa **sebelum** mengambil lock, dan pada cabang "hash tidak cocok" ia memanggil `releaseLock(jobId, 'error', …)`:

```ts
// SEBELUM — releaseLock dipanggil tanpa acquireLock lebih dulu
if (job.deliverable_hash && computed !== job.deliverable_hash) {
  await releaseLock(jobId, 'error', 'Hash deliverable tidak cocok');
  return { skipped: 'hash mismatch' };
}
const locked = await acquireLock(jobId, ['idle', 'error'], 'running_structural');
```

`releaseLock` menulis `job_state` **tanpa syarat**. Kalau job kebetulan sedang `running_verify`, panggilan itu **menimpa state-nya jadi `'error'` dan menghentikan verifikasi yang sedang berjalan** — padahal indexer cuma lewat untuk mengecek.

Sekarang: lock dulu, lalu **baca ulang di dalam lock** (pemeriksaan di luar cuma saringan murah, supaya indexer tidak mengambil lock untuk job yang jelas belum siap). Sudah dibuktikan — job berstatus `running_verify` tetap utuh setelah `confirmStructural` dipanggil.

#### 2–4. Endpoint ini menentukan ke mana uang mengalir

Isi deliverable dipakai sebagai **konteks yang dibaca Oracle** saat verifikasi, dan hasil verifikasi menentukan dana cair ke freelancer atau kembali ke client. Jadi penjaganya harus setara dengan `POST /api/jobs`:

- **Interlock produksi** — `CHAIN_ENABLED=false` di produksi ditolak mentah-mentah
- **Batas panjang** — isi ini dikirim ke AI, jadi panjangnya menentukan biaya panggilan
- **Rate limit** 2 detik per job

> **Batas yang harus disadari:** sebelum transaksi terkirim, `deliverable_hash` masih kosong — sehingga siapa pun bisa menulis konten untuk job itu. Yang menutupnya adalah hash on-chain: begitu tx mendarat, konten **beku**, dan kiriman apa pun yang hash-nya berbeda ditolak. Dengan `CHAIN_ENABLED=false` pelindung itu tidak ada — itulah alasan interlock produksi.

#### 6. Aturan structural jadi fungsi murni

`checkStructural(content, brand)` dipindah ke `lib/structural.ts`. Tidak menyentuh database maupun jaringan, jadi bisa diuji langsung — 14 pemeriksaan termasuk batas persis 39 vs 40 karakter.

Syarat keduanya bukan formalitas:

| Syarat | Kenapa |
|---|---|
| Panjang ≥ 40 | Menyaring "ok", "sudah", spasi kosong **sebelum** freelancer bayar gas |
| Menyebut brand | Isi ini jadi konteks Oracle. Tanpa nama brand di dalamnya, verifikasi hampir pasti gagal — dan itu baru ketahuan **setelah** panggilan AI dibayar |

#### 7. Periksa ulang di dalam lock

Route sudah menolak konten buruk, tapi `confirmStructural` memeriksanya lagi. Alasannya: konten bisa masuk lewat jalur lain — indexer, migrasi data, atau perbaikan manual langsung di Supabase.

### 7.3 Yang TIDAK ada di sini

`Math.round(Number(budget_wei) * 0.2)`. Roadmap v1 menghitung pencairan struktural di backend lalu menuliskannya ke database. Itu salah dua kali: presisi hilang lewat `Number()`, dan angka di database bisa berbeda dari yang benar-benar dipindahkan kontrak. **Sumber kebenaran satu-satunya adalah event on-chain**, dan indexer yang menuliskannya.

#### Structural gagal harus SAMPAI ke kontrak (ditambahkan di Fase 9)

Versi Fase 7 hanya menandai `job_state='error'` saat structural gagal, dan berhenti di situ. Kontraknya tidak pernah diberi tahu.

Akibatnya baru terlihat setelah jalur tulis hidup: job tertinggal di status `Submitted` **selamanya**. `submitDeliverable` menolak status itu, jadi freelancer tidak bisa mengirim perbaikan — dan dana terkunci sampai ada yang memanggil `escalateStuckJob()` setelah 7 hari. Kegagalan yang seharusnya sepele ("kontennya kurang 5 karakter") berubah jadi sengketa.

```ts
const { hash: txHash } = await rejectStructuralOnChain(BigInt(jobId), alasan);
await releaseLock(jobId, 'idle', alasan);
return { ok: false, skipped: `structural gagal: ${structural.reason}`, rejectedOnChain: txHash };
```

Dua hal yang gampang salah di sini:

- **`'idle'`, bukan `'error'`.** Penolakan structural adalah hasil yang SAH. Kalau ditandai `error`, `reclaimStaleLocks()` dan tombol coba-lagi di UI akan memperlakukannya sebagai sesuatu yang perlu diulang — padahal yang perlu terjadi adalah freelancer mengirim konten baru. `last_error` tetap diisi supaya alasannya terbaca.
- **Cabang "hash tidak cocok" TIDAK ikut menolak on-chain.** Itu bukan konten yang jelek, melainkan tanda isi di database berbeda dari yang ditandatangani — kemungkinan data kita yang bermasalah. Cabang itu tetap `'error'` dan butuh perhatian manusia.

### 7.4 Verifikasi

Unit test — 14 pemeriksaan `checkStructural` di `scripts/check-input.ts`.

Uji integrasi terhadap database sungguhan:

| Uji | Hasil |
|---|---|
| Konten < 40 karakter | 422, pesan menyebut jumlah karakter |
| Panjang cukup, tanpa nama brand | 422 |
| Konten valid | 200 + `deliverableHash` |
| Kirim ulang isi **sama** | 200 (hash sama) |
| Kirim isi **berbeda** setelah hash terkunci | **400 `HASH_MISMATCH`** |
| Job status `Open` / `ReleasedFull` | 409 |
| `content` bukan teks / kosong / `jobId` huruf | 400 |

`confirmStructural`:

| Kondisi | Hasil |
|---|---|
| Status masih `Accepted` | dilewati |
| Status `Submitted` + konten ada | `{ok:true, txHash}` |
| `deliverable_hash` tidak cocok | dilewati, `job_state='error'` + `last_error` |
| Konten hilang, job sedang `running_verify` | dilewati, **`job_state` TETAP `running_verify`** ← bukti perbaikan #1 |

> **Catatan jujur soal idempotensi.** Memanggil `confirmStructural` dua kali saat `CHAIN_ENABLED=false` menghasilkan `ok:true` dua kali, bukan "dilewati". Sebabnya tidak ada indexer yang menaikkan status `Submitted → Verifying`, jadi penjaga statusnya tidak pernah aktif. Dengan chain menyala alurnya: `confirmStructural → tx → event → indexer set 'Verifying' → panggilan berikutnya kena penjaga status`. **Idempotensinya bergantung pada indexer (Fase 10)**, bukan pada fungsi ini sendiri.

**Selesai kalau:** `npm run check` menutup dengan **`gagal: 0`** pada ketiga berkas uji; `tsc` dan `lint` bersih; dan kedua tabel di atas cocok semua.


---

## FASE 8 — Verifikasi + Verdict (≈3 jam)

Inti sistem. Di sinilah VRF, AI, keputusan, dan settlement bertemu — dan di sinilah uang berpindah.

File: `lib/flows/verify.ts`, `app/api/jobs/[id]/verify/route.ts`, `app/api/jobs/[id]/verdict/route.ts`.

### 8.1 Delapan penyesuaian dari rancangan awal

| # | Masalah | Sisi | Perbaikan |
|---|---|---|---|
| 1 | **Settlement berhasil tapi penyimpanan gagal → pembayaran ganda** | fungsionalitas | simpan verdict DULU, baru settle |
| 2 | **Penanda "settlement gagal" lenyap saat lock diambil** | fungsionalitas | jalur ditentukan sebelum lock |
| 3 | Pemeriksaan dilakukan sebelum lock, lalu pakai data basi | fungsionalitas | baca ulang di dalam lock |
| 4 | Tidak ada interlock produksi | keamanan | sama seperti Fase 6 & 7 |
| 5 | `jobId: number \| string` | fungsionalitas | `parseJobId()` |
| 6 | Endpoint audit cuma membandingkan hash | requirement | subset & keputusan ikut dihitung ulang |
| 7 | Tidak ada penanda kalau chain mati | fungsionalitas | `chainEnabled` di respons |
| 8 | `job.verdict_json as Verdict` tanpa pengaman | fungsionalitas | dibungkus try/catch |

#### 1. Urutan yang mencegah pembayaran ganda

Rancangan awal: **settle dulu (langkah 6), simpan belakangan (langkah 7).**

Kalau penyimpanan gagal setelah transaksi berhasil — database sesaat tidak terjangkau, jaringan putus — hasilnya: **dana SUDAH berpindah on-chain, tapi database tidak punya catatan verdict sama sekali.** `verification_decision` masih `null`, sehingga percobaan berikutnya mengulang seluruh verifikasi **dan memanggil `settleOnChain` lagi**. Itu pembayaran ganda.

Urutannya sekarang dibalik:

```
1-5. hitung verdict (seed → subset → AI → keputusan → hash)
6.   SIMPAN ke database        ← lock masih dipegang
7.   baru kirim on-chain
8.   lepas lock
```

Kalau langkah 7 gagal, verdict sudah tersimpan dan `job_state` jadi `'error'`. Percobaan berikutnya mengenali kondisi itu dan **hanya mengulang settlement**, memakai verdict yang sama persis — hash identik, tanpa satu pun panggilan AI baru.

#### 2. Penanda yang lenyap karena lock-nya sendiri

Bug ini baru ketahuan saat diuji, dan sangat halus:

```ts
// SEBELUM — pemeriksaan dilakukan SETELAH lock diambil
const locked = await acquireLock(jobId, ['idle', 'error'], 'running_verify');
const job = await getJob(jobId);
if (job.verification_decision && job.job_state !== 'error') throw 'sudah diverifikasi';
```

`acquireLock()` **menimpa `job_state` jadi `'running_verify'`**. Jadi saat baris pemeriksaan dijalankan, penanda `'error'` — satu-satunya petunjuk bahwa verdict sudah ada tapi settlement-nya gagal — **sudah lenyap**. Hasilnya: setiap percobaan mengulang settlement yang gagal selalu ditolak "sudah diverifikasi", dan job itu **tidak akan pernah bisa diselesaikan**.

Sekarang jalurnya ditentukan dari data **sebelum** lock:

```ts
const preview = await getJob(jobId);
const isResume = Boolean(preview.verification_decision && preview.job_state === 'error');
const locked = await acquireLock(...);
```

#### 3. Baca ulang di dalam lock

Pemeriksaan di luar cuma saringan murah. Di dalam lock data dibaca ulang, dan kalau **bukan** jalur lanjutan, `verification_decision` harus masih kosong — kalau sudah terisi, berarti proses lain menyelesaikannya di antara saringan dan pengambilan lock kita. Jangan dihitung ulang lalu di-settle lagi.

#### 6. Endpoint audit: dari satu pemeriksaan jadi tiga

Rancangan awal hanya membandingkan hash verdict dengan yang on-chain. Itu membuktikan "yang dipublikasi = yang dikirim ke blockchain", tapi **tidak** membuktikan isinya benar.

Sekarang tiga hal dihitung ulang, dan ketiganya bisa diulangi siapa pun:

| Pemeriksaan | Kecurangan yang ketahuan |
|---|---|
| `subsetMatches` | Oracle mengulang undian sampai dapat pertanyaan yang menguntungkan |
| `decisionMatches` | Skor dipelintir supaya keputusannya berubah |
| `hashMatchesStored` / `hashMatchesChain` | Verdict yang dipublikasi berbeda dari yang dikirim on-chain |

Respons juga menyertakan `canonical` — string persis yang di-`keccak256` — supaya pihak luar bisa menghitung sendiri tanpa menebak format kami.

> `allChecksPassed` sengaja **tidak** mengikutkan `hashMatchesChain` saat `CHAIN_ENABLED=false`. Kalau diikutkan, nilainya selalu `false` dan kehilangan arti.

#### 7. Penanda `chainEnabled`

Tanpa ini, verdict hasil pengembangan bisa disangka hasil sungguhan: seed-nya deterministik dan tidak ada transaksi apa pun yang benar-benar terjadi. Respons `verify` dan `verdict` sama-sama menyebutkannya.

### 8.2 Verifikasi

`npx tsx scripts/dev-verify.ts` — 19 pemeriksaan, tanpa perlu menjalankan dev server.

> **Kenapa lewat skrip, bukan HTTP:** `next dev` memakai Turbopack yang butuh ratusan MB. Di mesin dengan RAM terbatas ia bisa gagal alokasi (`memory allocation failed`) — persis yang terjadi saat fase ini dikerjakan. Skrip hanya memuat `lib/` yang dipakai, jadi jauh lebih ringan.

| Kelompok | Yang dibuktikan |
|---|---|
| Verifikasi pertama | decision, subset, hash keccak256, `job_state` kembali `idle`, semua kolom tersimpan |
| Verifikasi kedua | ditolak `WRONG_STATUS` |
| **Audit** | subset bisa diturunkan ulang dari seed, keputusan bisa dihitung ulang, hash cocok |
| **Pembayaran ganda** | verdict **identik**, `resumedSettlement: true`, **nol panggilan AI baru** |
| Status salah | ditolak |

**Selesai kalau:** `npx tsx scripts/dev-verify.ts` menutup dengan `gagal: 0`; `npm run check` `gagal: 0` di ketiga berkas; `tsc` dan `lint` bersih.


---

## FASE 9 — Chain: Baca (≈2 jam)

### 9.1 Fakta deployment — sudah terverifikasi langsung dari chain

| | |
|---|---|
| Alamat kontrak | `0x41462F3092Ca66b7B3d9c8b20337793e2756cC46` |
| Jaringan | BSC Testnet, chain ID **97** |
| Blok deploy | **130.726.113** ← dipakai `indexer_state`, lihat Fase 10 |
| RPC | `https://bsc-testnet-rpc.publicnode.com` (cadangan: `bsc-testnet.drpc.org`) |
| Oracle | `0xa3291638aeE37B076E7CA389C3fd28d5B73a4791` |
| Arbiter | `0xd1ff61def4D7c6dB938A4501f460b5176fcbCd78` |
| Owner | `0x8766d055bB79B511FCC34Bd1573ce612dFa4057D` |
| `BOND_BPS` / `STRUCTURAL_BPS` | 500 (5%) / 2000 (20%) |
| `verifyTimeout` | 604.800 detik (7 hari) |

> **RPC lama sudah mati.** `data-seed-prebsc-1-s1.bnbchain.org` yang tertulis di rancangan awal tidak lagi merespons. Sudah diganti di `.env.local`.

### 9.2 `lib/abi.ts` — SELESAI, jangan diketik ulang

ABI disalin utuh dari `out/GeoEscrow.sol/GeoEscrow.json` (field `"abi"`). **Jangan pernah mengetiknya manual atau mengedit sebagian** — nama argumen event di dalamnya adalah kontrak antara indexer dan kontrak, dan satu huruf meleset membuat indexer gagal **diam-diam** (tidak ada error, datanya cuma tidak pernah masuk).

Diverifikasi terhadap kontrak yang hidup lewat `npx tsx scripts/dev-chain-check.ts` — 11 pemeriksaan, semuanya lolos. Yang paling meyakinkan adalah `getJob()`: kalau bentuk tuple-nya meleset satu field saja, viem gagal men-decode.

### 9.3 Tiga hal tentang kontrak yang mudah salah

#### `jobId` PERTAMA ADALAH 0, bukan 1

Dibuktikan dengan mensimulasikan `createJob` lewat `eth_call` (tanpa mengirim transaksi): nilai kembaliannya `0`. Kontrak memakai `jobCount++`, bukan `++jobCount`.

Dua konsekuensi yang gampang terlewat:

```ts
// BAHAYA: jobId 0 itu falsy
const jobId = Number(log.args?.jobId ?? 0);   // ← "tidak ada" jadi sama dengan job 0
if (!jobId) return;                            // ← job 0 yang sah ikut terbuang
```

Dan: **data seed kita memakai job_id 1–6, yang akan BENTROK** dengan job on-chain sungguhan (0, 1, 2, …). Sebelum `CHAIN_ENABLED=true` dipakai serius, hapus data seed atau pindahkan ke rentang tinggi.

#### `getJob()` ≠ `jobs()`

Keduanya ada di ABI, tapi bentuknya berbeda:

| | `getJob(id)` | `jobs(id)` |
|---|---|---|
| Nama field bond | `bond` | `bondAmount` |
| `submittedAt` | tidak ada | ada |
| Urutan field | dikunci sesuai spek §3.2 | urutan storage |

**Selalu pakai `getJob()`.** Itu yang bentuknya disepakati; `jobs()` cuma getter bawaan Solidity untuk mapping publik dan bisa berubah kalau struct-nya di-refactor.

#### `status` adalah `uint8`, urutannya mengikat

```ts
export const STATUS_BY_INDEX = [
  'Open', 'Accepted', 'Submitted', 'Verifying',
  'Disputed', 'ReleasedFull', 'Refunded',
] as const;
```

Sudah dicocokkan dengan bytecode: settle-release menulis 5 (`ReleasedFull`), settle-refund menulis 6 (`Refunded`), `escalateStuckJob` menulis 4 (`Disputed`), `reclaimExpired` menulis 6. Cocok dengan urutan di atas.

### 9.4 `lib/chain-server.ts` — melengkapi yang sudah ada

File ini dibuat di Fase 6 dengan jalur `CHAIN_ENABLED=false` lengkap. Yang dikerjakan di sini adalah mengganti pelemparan `notYet()` dengan panggilan viem sungguhan.

**Sepuluh penyesuaian dari rancangan awal.** Empat yang pertama sudah terlihat saat membaca ABI; enam sisanya baru muncul saat kodenya benar-benar dijalankan terhadap kontrak hidup.

| # | Masalah | Perbaikan |
|---|---|---|
| 1 | **Error RPC disamakan dengan "job tidak ada"** | dibedakan — RPC gagal harus melempar |
| 2 | `OnChainJob` kurang 3 field | `verificationSeed`, `structuralReleased`, `acceptDeadline` |
| 3 | Tidak ada `rejectStructuralOnChain` | ditambahkan (fungsinya sekarang ada di kontrak) |
| 4 | Tidak ada pembaca `requiredBond` | ditambahkan — FE butuh untuk `acceptJob` |
| 5 | **Seed nol dipakai apa adanya** | ditolak — subset jadi bisa ditebak |
| 6 | **`requiredBond` job tak-ada mengembalikan 0** | dijaga `jobCount` — 0 membuat `acceptJob` pasti gagal |
| 7 | Kunci oracle salah = revert tanpa petunjuk | alamatnya dicocokkan dengan `oracle()` sekali per proses |
| 8 | **Dua settlement bersamaan merebut nonce** | semua tulis diantrekan satu-per-satu |
| 9 | Revert setelah masuk blok dilaporkan sukses | `simulateContract` dulu, lalu `receipt.status` diperiksa |
| 10 | **Settle ulang bisa memindahkan dana dua kali** | status kontrak diperiksa dulu — `alreadyDone` |

#### 1. Jangan samakan RPC mati dengan job tidak ada

```ts
// SEBELUM — semua error ditelan jadi null
try {
  return await readContract(...);
} catch {
  return null;    // RPC putus? Kontrak salah alamat? Sama-sama null.
}
```

`null` dari `readJobFromChain()` dibaca `POST /api/jobs` sebagai **"Job belum ada di blockchain — kirim transaksi dulu"**. Jadi kalau RPC sedang bermasalah, setiap pembuatan job ditolak dengan pesan yang **menyesatkan** — user akan mengira transaksinya gagal dan mengirim ulang, membayar gas dua kali.

```ts
export async function readJobFromChain(jobId: bigint): Promise<OnChainJob | null> {
  if (!env.chainEnabled) return null;   // verifikasi sengaja dilewati

  const total = await publicClient().readContract({
    address: escrowAddress(), abi: geoEscrowAbi, functionName: 'jobCount',
  }) as bigint;

  // Di luar jangkauan = benar-benar belum ada. Ini satu-satunya alasan
  // sah mengembalikan null saat chain menyala. jobId pertama 0, jadi
  // jangkauannya [0, total) -- perbandingannya >= , bukan > .
  if (jobId < 0n || jobId >= total) return null;

  // Error apa pun setelah ini adalah masalah infrastruktur -- biarkan
  // melempar supaya muncul sebagai 502, bukan menyamar jadi 400.
  const r = await publicClient().readContract({
    address: escrowAddress(), abi: geoEscrowAbi,
    functionName: 'getJob', args: [jobId],
  });
  return r as unknown as OnChainJob;
}
```

> `null` punya DUA arti yang berbeda dan pemanggil wajib membedakannya lewat `env.chainEnabled`: saat chain mati artinya "verifikasi dilewati"; saat chain menyala artinya "job memang belum ada".

#### 2. `OnChainJob` harus 11 field, sama persis dengan `getJob()`

```ts
export interface OnChainJob {
  client: string;
  freelancer: string;
  queryPoolHash: string;
  deliverableHash: string;
  verdictHash: string;
  verificationSeed: string;   // <- dipakai Fase 8
  budget: bigint;
  bond: bigint;
  structuralReleased: bigint; // <- dipakai indexer
  status: number;             // uint8, lihat STATUS_BY_INDEX
  acceptDeadline: bigint;     // unix DETIK (uint64 di createJob)
}
```

`acceptDeadline` satuannya **unix detik**, bukan nomor blok — kontrak membandingkannya langsung dengan `block.timestamp`. Konversi ke kolom `timestamptz`: `new Date(Number(acceptDeadline) * 1000)`.

#### 3–4. Dua fungsi baru

```ts
/** Structural gagal -> kembalikan job ke Accepted supaya bisa submit ulang. */
export async function rejectStructuralOnChain(jobId: bigint, reason: string): Promise<TxResult>

/** Berapa bond yang harus dikirim FE saat acceptJob. */
export async function readRequiredBond(jobId: bigint): Promise<bigint>
```

`reason` masuk ke event `StructuralRejected` dan **terbaca publik selamanya**. Jangan pernah menaruh isi deliverable, alamat email, atau apa pun yang bersifat pribadi di sana. Kodenya memotongnya di 200 karakter.

#### 5. Seed nol harus ditolak, bukan dipakai

`verificationSeed(jobId)` baru terisi saat kontrak menjalankan `confirmStructural`. Sebelum itu nilainya `0x000…0`.

Membiarkannya lewat tidak menyebabkan error apa pun — `deriveSubset()` menerima seed apa saja dan mengembalikan subset yang valid. Justru itu bahayanya: subsetnya jadi **sama untuk setiap job** dan bisa dihitung siapa pun jauh sebelum verifikasi. Freelancer tinggal mengoptimalkan kontennya untuk lima pertanyaan yang sudah ia tahu akan terpilih.

```ts
if (/^0x0*$/.test(seed)) {
  throw new Error(`verificationSeed job ${jobId} masih nol — confirmStructural belum dijalankan`);
}
```

#### 6. `requiredBond` mengembalikan 0, bukan revert

Diuji langsung ke kontrak: `requiredBond(0)` untuk job yang belum ada **tidak revert** — Solidity membaca struct kosong dan mengembalikan `0`.

Angka itu kalau diteruskan ke FE membuat tombol "Ambil kontrak" mengirim `acceptJob` dengan `value: 0`, yang pasti ditolak kontrak — dan freelancer membayar gas untuk transaksi yang tidak mungkin berhasil. Penjaganya ada di sisi kita, karena kontraknya tidak menjaga.

#### 7. Kunci oracle yang salah harus ketahuan di baris pertama

Kalau `ORACLE_PRIVATE_KEY` diisi kunci yang bukan milik wallet oracle, **setiap** transaksi revert dengan pesan mentah EVM — `execution reverted`, tanpa petunjuk ke mana pun. Penyebabnya cuma satu baris di `.env.local`, tapi menemukannya bisa makan berjam-jam.

`assertOracleWallet()` membandingkan alamat turunan kunci dengan `oracle()` on-chain, sekali per proses, dan kalau meleset ia menyebut kedua alamat sekaligus saran perbaikannya (`setOracle(…)`). Bentuk kuncinya divalidasi lebih dulu — dan **pesan error-nya tidak pernah memuat isi kunci**.

#### 8. Satu wallet, satu antrean

Lock per-job di `jobs-repo` tidak menolong di sini: yang bentrok bukan job-nya, tapi **wallet-nya**. Dua job yang di-settle bersamaan mengambil nonce yang sama dari RPC, lalu salah satunya ditolak `nonce too low` — padahal keduanya sah.

```ts
let antrean: Promise<unknown> = Promise.resolve();

function antre<T>(fn: () => Promise<T>): Promise<T> {
  const hasil = antrean.then(fn, fn);
  antrean = hasil.catch(() => undefined);   // rantai tidak boleh putus
  return hasil;
}
```

#### 9. Simulasi dulu, dan periksa receipt

Dua hal yang sama-sama diam kalau dilewatkan:

- **`simulateContract` sebelum menulis.** Fungsinya dijalankan di node tanpa mengirim apa pun, jadi revert ketahuan **sebelum** gas terbayar — dan pesannya menyebut alasan revert. Kalau simulasi gagal, kodenya membaca status on-chain dan memasukkannya ke pesan error, karena penyebabnya hampir selalu "status kontrak tidak seperti yang kita kira".
- **`receipt.status`.** viem **tidak melempar** untuk transaksi yang masuk blok lalu revert. Tanpa baris pemeriksaan itu, settlement yang gagal akan dilaporkan sukses ke pemanggil — dan database mencatat dana sudah cair padahal tidak.

#### 10. Idempotensi diputuskan oleh kontrak, bukan oleh catatan kita

Skenarionya nyata: transaksi settle terkirim, receipt-nya tidak pernah sampai (timeout, RPC putus). Backend menandai job `error`. Percobaan berikutnya memanggil `settleOnChain` lagi — padahal dana **sudah** berpindah.

Fase 8 sudah menutup separuh masalah ini dengan menyimpan verdict lebih dulu. Separuh sisanya ditutup di sini: sebelum mengirim apa pun, statusnya dibaca dari kontrak.

```ts
const SETTLE = {
  release: { fn: 'settleRelease', tujuan: [5] },        // ReleasedFull
  refund:  { fn: 'settleRefund',  tujuan: [6] },        // Refunded
  dispute: { fn: 'raiseDispute',  tujuan: [4, 5, 6] },  // arbiter bisa sudah memutus
} as const;

if (await sudahLewat(jobId, tujuan)) return { hash: '0xsudah', alreadyDone: true };
```

Sentinel `'0xsudah'` sengaja dibedakan dari `'0xdev'`. Keduanya berarti "tidak ada transaksi", tapi sebabnya berbeda jauh: yang satu mode pengembangan, yang satu lagi **bukti bahwa uangnya sudah berpindah**. `alreadyDone` diteruskan ke `VerifyResult.alreadySettled` dan `ConfirmResult.alreadyDone`, supaya respons API tidak berbohong soal ada-tidaknya transaksi.

### 9.5 Verifikasi

```bash
npx tsx scripts/dev-chain-check.ts   # ABI cocok dengan kontrak     (11 cek)
npx tsx scripts/dev-chain-read.ts    # logika pembungkusnya benar   (17 cek)
```

Keduanya **tidak butuh private key** dan **tidak mengirim transaksi apa pun** — semuanya `eth_call`.

`dev-chain-read.ts` menguji hal yang tidak bisa dijamin ABI: bahwa `null` berarti "job belum ada" dan bukan "RPC bermasalah", bahwa seed nol ditolak, bahwa `requiredBond` tidak diam-diam mengembalikan 0, dan bahwa kedua penjaga private key bekerja. Yang terakhir diuji dengan kunci acak sekali pakai (`generatePrivateKey()`) yang tidak pernah memegang dana dan tidak ditulis ke mana pun — keduanya gagal **sebelum** `writeContract`, jadi tidak ada transaksi yang lahir dari pengujian.

**Selesai kalau:** keduanya menutup dengan `gagal: 0`.

> `jobCount()` masih **0** — belum ada satu pun job di kontrak. Jalur tulis (`confirmStructural`, `rejectStructural`, `settleRelease`, `settleRefund`, `raiseDispute`) sudah ditulis lengkap tapi **belum pernah dijalankan sungguhan**: itu butuh `ORACLE_PRIVATE_KEY` dan minimal satu job hasil `createJob()` dari wallet client.

---

## FASE 10 — Indexer + Sync (≈3 jam)

### 10.1 Kenapa perlu

Blockchain tidak bisa memanggil server kamu. Kalau ada yang menjalankan `acceptJob`, kontrak hanya memancarkan event ke dalam blok — tidak ada yang mengetuk pintu backend. Jadi harus ada yang **rajin bertanya**: "sejak blok terakhir yang kucatat, ada event baru?"

Dua jalur, sengaja:

| Jalur | Kapan | Kecepatan |
|---|---|---|
| `POST /api/sync/:id` | FE memanggilnya segera setelah tx dapat receipt | instan |
| `GET /api/indexer/poll` | Cron, tiap 1–5 menit | jaring pengaman |

**Demo panggung tidak boleh bergantung pada cron.** Jalur pertama yang membuat UI terasa hidup; jalur kedua hanya menangkap yang terlewat (user menutup tab, tx dari luar aplikasi).

### 10.2 Delapan penyesuaian dari rancangan awal

| # | Masalah | Sisi | Perbaikan |
|---|---|---|---|
| 1 | **`StructuralConfirmed` membaca `log.args.freelancer` yang TIDAK ADA** | fungsionalitas | event-nya `(jobId, amount, seed)` |
| 2 | **`seed` dari event dibuang** | fungsionalitas | disimpan ke `verification_seed` |
| 3 | **`StructuralRejected` tidak ditangani** | fungsionalitas | job dikembalikan ke `Accepted` |
| 4 | **`BondSettled` tidak ditangani** | fungsionalitas | baris `bond_return` / `bond_slash` |
| 5 | **Indexer mulai dari blok 0** | performa | disemai dari blok deploy — tapi lihat §10.2a: RPC memangkas log, jadi bookmark juga diklem otomatis |
| 6 | `syncJob` menyaring di sisi klien | performa | pakai filter topic `jobId` |
| 7 | `jobId ?? 0` — job 0 itu sah | fungsionalitas | sentinel `-1`, bukan `0` |
| 8 | `applyLog(log: any)` | kualitas | tipe diturunkan dari ABI |

#### 1–2. `StructuralConfirmed` — dua kesalahan sekaligus

Event sungguhannya (dari ABI):

```solidity
StructuralConfirmed(uint256 indexed jobId, uint256 amount, bytes32 seed)
```

Rancangan awal menulis `to_addr: log.args.freelancer` — **argumen itu tidak ada**. Hasilnya `undefined` masuk ke kolom `to_addr`, dan halaman Aktivitas menampilkan pencairan 20% tanpa penerima.

Dan `seed` — yang justru paling berharga — **dibuang**. Padahal itu seed VRF yang menentukan subset verifikasi. Dengan menyimpannya di sini, Fase 8 tidak perlu memanggil `verificationSeed()` terpisah, dan yang lebih penting: **seed-nya terekam di database persis seperti yang dipancarkan kontrak**, jadi audit tidak bergantung pada pembacaan ulang yang bisa berbeda.

```ts
case 'StructuralConfirmed':
  await patch({
    status: 'Verifying',
    structural_released_wei: String(log.args.amount),
    verification_seed: log.args.seed,      // ← jangan dibuang
  });
  await act('structural_release', {
    amount_wei: String(log.args.amount),
    to_addr: job?.freelancer_addr ?? null, // ← dari DB, bukan dari event
    note: 'Structural check lolos',
  });
  break;
```

#### 3. `StructuralRejected` — tanpa ini job macet selamanya

Kontrak mengembalikan status ke `Accepted` supaya freelancer bisa submit ulang. Kalau indexer tidak ikut menurunkannya, **database kita tetap bilang `Submitted`** sementara on-chain sudah `Accepted` — FE menampilkan "cek struktural…" selamanya, dan freelancer tidak pernah tahu kenapa ditolak.

```ts
case 'StructuralRejected':
  await patch({
    status: 'Accepted',
    job_state: 'error',
    last_error: `Structural ditolak: ${log.args.reason}`,
    deliverable_hash: null,   // hash lama tidak berlaku lagi
  });
  await act('structural_rejected', { note: String(log.args.reason).slice(0, 200) });
  break;
```

#### 4. `BondSettled` — pergerakan bond hilang dari ledger

`settleRelease` memindahkan **dua** jumlah: sisa budget (event `Settled`) dan bond (event `BondSettled`). Tanpa menangani yang kedua, tipe `bond_return` dan `bond_slash` yang sudah ada di CHECK constraint tabel `activity` **tidak akan pernah terisi** — padahal prototipe menampilkannya sebagai baris tersendiri.

```ts
case 'BondSettled':
  await act(log.args.slashed ? 'bond_slash' : 'bond_return', {
    amount_wei: String(log.args.amount),
    to_addr: log.args.recipient,
    note: log.args.slashed
      ? 'Bond freelancer di-slash (gagal capai target)'
      : 'Bond freelancer dikembalikan',
  });
  break;
```

#### 5. Indexer mulai dari blok 0 — 65.000 permintaan RPC

`last_block_processed` default `0`, dan tiap putaran memproses 2.000 blok. Kontrak di-deploy pada blok **130.726.113**. Artinya indexer akan menyisir **65 ribu rentang blok kosong** sebelum sampai ke blok pertama yang relevan — berjam-jam, dan hampir pasti kena rate limit RPC publik.

Semai barisnya sekali di Supabase SQL Editor:

```sql
insert into indexer_state (contract_addr, last_block_processed)
values (lower('0x41462F3092Ca66b7B3d9c8b20337793e2756cC46'), 130726112)
on conflict (contract_addr) do nothing;
-- 130726112 = satu blok SEBELUM deploy, supaya blok deploy sendiri ikut terbaca.
```

> Kolom kunci tabel ini **per alamat kontrak**, bukan `id = 1`. Selama hackathon kalian kemungkinan besar akan re-deploy; kalau bookmark-nya global, indexer akan mulai dari blok kontrak lama dan melewatkan semua event kontrak baru.

#### 6. `syncJob` — saring di server, bukan di klien

```ts
// SEBELUM: ambil SEMUA event 5.000 blok terakhir, lalu buang yang bukan milik kita
const logs = await getContractEvents({ fromBlock: latest - 5000n, toBlock: latest });
for (const log of logs) { if (log.args.jobId !== jobId) continue; ... }
```

Dua masalah: boros (mengunduh event job lain), dan **5.000 blok di BSC Testnet cuma 38 menit** — job yang dibuat pagi ini pun sudah di luar jangkauan sore harinya. (Angka ini terukur, bukan perkiraan; lihat §10.2a.)

`jobId` bertanda `indexed` di semua event job, jadi bisa disaring di sisi RPC lewat topic:

```ts
const logs = await publicClient().getContractEvents({
  address: escrowAddress(),
  abi: geoEscrowAbi,
  args: { jobId: BigInt(jobId) },   // ← filter topic, dikerjakan RPC
  fromBlock: tip - SYNC_LOOKBACK,   // BUKAN dari blok deploy -- lihat §10.2a
  toBlock: tip,
});
```

> **Rentangnya tetap harus dibatasi.** Rancangan awal menyarankan dari blok deploy sampai `latest` dengan alasan "hasilnya sudah tersaring topic". RPC menolak permintaannya jauh sebelum penyaringan itu terjadi — dan bahkan kalau tidak, node-nya sudah tidak menyimpan log setua itu. Dua batas keras di §10.2a.

#### 7. `jobId ?? 0` — job 0 itu job yang sah

Sudah dibuktikan di Fase 9: **jobId pertama adalah 0.** Jadi:

```ts
const jobId = Number(log.args?.jobId ?? 0);   // ← "tidak ada" menyamar jadi job 0
```

Ganti sentinelnya dengan nilai yang mustahil:

```ts
const raw = log.args?.jobId;
if (raw === undefined) return;      // event non-job (OracleChanged, dst)
const jobId = Number(raw);
```

#### 8. Log bertipe, bukan `any`

Dengan ABI sungguhan, viem bisa menurunkan tipe tiap event — `log.args.freelancer` pada `StructuralConfirmed` akan **ditolak compiler**, bukan diam-diam `undefined` seperti temuan #1.

### 10.2a Fakta jaringan — diukur 23 Sep 2026, bukan diasumsikan

Rancangan awal memakai angka BSC Mainnet (3 detik per blok). **Testnet jauh lebih cepat**, dan selisihnya cukup besar untuk membuat beberapa keputusan di atas salah.

| | Terukur | Cara mengukurnya |
|---|---|---|
| Waktu blok | **0,45 detik** | selisih `timestamp` antara dua blok berjarak 10.000 |
| Blok per hari | ~192.000 | turunan dari angka di atas |
| Blok deploy 130.726.113 | 13 Sep 2026, 04:23 UTC | `getBlock().timestamp` — cocok dengan catatan serah terima |
| Tertinggal dari blok deploy | ~1,9 juta blok (10 hari) | per 23 Sep 2026 |

**Konsekuensi untuk ukuran chunk.** Dengan 2.000 blok per putaran, satu putaran cuma mencakup **15 menit** waktu rantai — dan mengejar ketertinggalan dari blok deploy butuh **951 permintaan RPC**. Itu tidak muat di satu invocation serverless.

RPC-nya sendiri jauh lebih longgar dari dugaan. Diuji langsung ke `bsc-testnet-rpc.publicnode.com`:

```
eth_getLogs    500 blok  ->  ok  (184ms)
             1.000 blok  ->  ok  (144ms)
             5.000 blok  ->  ok  (148ms)
            50.000 blok  ->  ok  (257ms)
```

Waktunya nyaris tidak bergerak — yang dibatasi jumlah *log* yang cocok, bukan lebar rentangnya, dan kontrak ini masih sepi. Jadi:

> **Pakai 20.000 blok per putaran, bukan 2.000.** Mengejar ketertinggalan jadi 96 permintaan (~20 detik) alih-alih 951. Angka 20.000 dipilih dengan sisa ruang: 50.000 sudah terbukti jalan, jadi 20.000 tidak akan mepet bahkan kalau lalu lintasnya naik. Tetap potong per putaran — jangan sekali tembak dari blok deploy sampai tip, karena begitu kontraknya ramai, batas jumlah log yang akan kena, dan kegagalannya tidak kelihatan sampai saat itu.

**Cadangan RPC tidak bisa dipakai indexer.** `bsc-testnet.drpc.org` yang tertulis sebagai cadangan di `.env.local` menjawab `eth_blockNumber` dengan benar, tapi **menolak setiap `eth_getLogs`** — berapa pun lebar rentangnya. Jadi ia sah sebagai cadangan untuk pembacaan biasa (Fase 9), tapi kalau indexer dialihkan ke sana saat publicnode bermasalah, ia akan gagal diam-diam tanpa satu event pun masuk. Catat ini di `.env.local` supaya tidak ada yang menukarnya saat panik.

#### Dua batas keras RPC — keduanya ketahuan saat menjalankan uji

Ini bagian terpenting Fase 10, dan tidak satu pun tertulis di dokumentasi RPC-nya.

**Batas 1 — rentang `eth_getLogs` maksimal 50.000 blok.**

```
Details: exceed maximum block range: 50000
```

Filter topic **tidak** membebaskan batas ini: RPC menolak permintaannya sebelum penyaringan dimulai. Karena itu `CHUNK_BLOCKS = 20.000` (sisa ruang dari batas), dan ada penjaga di `runIndexer()` yang melempar kalau konstanta itu sampai dinaikkan melewati batas — supaya kegagalannya jelas, bukan `-32701` yang membingungkan.

**Batas 2 — log hanya disimpan ~90.000 blok terakhir (~11 jam).**

```
Details: History has been pruned for this block.
```

Ini yang mengubah rancangan. Kontrak di-deploy **1,9 juta blok** sebelum hari ini. Artinya menyusul dari blok deploy bukan "lambat" — melainkan **mustahil**: node-nya sudah tidak punya datanya, dan setiap rentang yang lebih tua ditolak.

Bookmark yang disemai di blok 130.726.112 karena itu akan membuat **setiap** putaran gagal di rentang pertama, selamanya, tanpa maju satu blok pun. `runIndexer()` menanganinya dengan melompat ke horizon pemangkasan, menyimpan bookmark baru, dan **melaporkan lompatannya di respons** (`blokDilompati`) — bukan menelannya diam-diam:

```
[indexer] bookmark 130726112 lebih tua dari log yang masih disimpan RPC
(tertua ~132550438). 1824325 blok DILOMPATI — event di rentang itu tidak
akan pernah masuk ledger. Status job tidak terpengaruh (diambil dari getJob).
```

**Apa yang benar-benar hilang, dan apa yang tidak:**

| | Terpengaruh pemangkasan? |
|---|---|
| Status job, budget, bond, seed, hash | **Tidak.** Semuanya dari `getJob()` — membaca storage saat ini, bukan log |
| Baris `activity` (halaman Aktivitas) | **Ya.** Hanya bisa memuat event ~11 jam terakhir |

Untuk hackathon ini tidak ada yang hilang — `jobCount()` masih 0, jadi belum ada satu pun event di rentang yang dilompati. Tapi kalau ledger harus lengkap sejak job pertama, RPC-nya harus diganti yang **arsip** (Alchemy, QuickNode, dan Ankr punya tier gratis dengan akses arsip). Itu satu-satunya obatnya; tidak ada trik di sisi kode.

**RPC lain yang sudah dicoba (23 Sep 2026):**

| Endpoint | Hasil |
|---|---|
| `bsc-testnet-rpc.publicnode.com` | **dipakai** — `eth_getLogs` jalan, retensi ~90.000 blok |
| `bsc-testnet.drpc.org` | `eth_blockNumber` jalan, **`eth_getLogs` selalu ditolak** |
| `bsc-testnet.public.blastapi.io` | tidak menjawab |
| `data-seed-prebsc-2-s1.bnbchain.org` | `eth_getLogs` ditolak |
| `bsc-testnet.blockpi.network` | tidak menjawab |

#### Kenapa `jobs` tidak lagi ditambal dari event

Rancangan awal menambal kolom `jobs` dari argumen tiap event. Itu rapuh di dua titik yang sama-sama tidak bersuara:

- **Log yang diproses dua kali** — retry, sync manual bertabrakan dengan cron, bookmark yang mundur — akan **menurunkan** status job yang sudah maju. `DeliverableSubmitted` yang terbaca ulang mengembalikan job dari `Verifying` ke `Submitted`.
- **Satu event terlewat** (pemangkasan di atas, persis) membuat statusnya macet, dan tidak ada yang tahu.

Di implementasi ini, event hanya mengisi **ledger**; kolom `jobs` selalu disegarkan dari `getJob()`:

```ts
const onChain = await readJobFromChain(BigInt(jobId));
await segarkanJob(jobId, onChain);   // status, budget, bond, seed, hash -- semua sekaligus
```

Satu panggilan RPC, dan hasilnya benar tanpa peduli urutan log, berapa kali diproses, atau berapa banyak yang hilang. Ini juga yang membuat `syncJob` tetap benar walau jendela log-nya cuma 45.000 blok.

Baris `activity` sendiri kebal-ganda lewat `unique (tx_hash, log_index)` + `ignoreDuplicates` — jadi sync manual boleh bertabrakan dengan cron tanpa menghasilkan ledger ganda.

#### Jarak aman dari ujung rantai

`runIndexer()` berhenti 15 blok sebelum ujung. Blok paling ujung masih bisa tergeser reorg, dan bookmark yang terlanjur melewatinya membuat event di blok itu **tidak akan pernah dibaca ulang**. Pada 0,45 detik/blok itu cuma ~7 detik keterlambatan — dan `syncJob` tetap membaca sampai `latest`, jadi demo tidak ikut melambat.


### 10.3 Dua hal yang sudah diputuskan — jalankan `supabase/migration-01-*.sql`

#### `DisputeRaised` belum punya tipe activity yang cocok

Rancangan awal memakai `'vrf_pick'`, yang salah arti — `vrf_pick` menandakan pemilihan subset, bukan sengketa. CHECK constraint tabel `activity` belum punya tipe untuk ini.

**Keputusan: tambah tipe lewat migrasi.** Migrasi yang sama sekaligus menambah `structural_rejected` yang dibutuhkan temuan #3, dan menyemai bookmark indexer dari blok deploy.

Sudah tersedia di `supabase/migration-01-activity-types-and-arbiter.sql` — jalankan di Supabase SQL Editor. File itu melakukan tiga hal: menambah tipe activity, menghapus `jobs.arbiter_addr` (lihat bagian berikutnya), dan menyemai bookmark indexer. Bagian pertamanya:

```sql
alter table activity drop constraint if exists activity_type_check;
alter table activity add constraint activity_type_check check (type in (
  'deposit','bond_lock','structural_release','structural_rejected',
  'dispute_raised','vrf_pick','final_release','final_refund',
  'jury_release','jury_refund','bond_return','bond_slash','reclaim'));
```

`vrf_pick` tetap dipertahankan karena prototipe memakainya untuk mencatat pemilihan subset — arti yang berbeda dari sengketa.

#### `jobs.arbiter_addr` tidak pernah terisi

Kolom itu ada di skema, tapi **tidak ada satu pun kode yang menulisnya** — dan memang tidak seharusnya: arbiter adalah nilai tingkat-kontrak (`arbiter()`), bukan per-job.

**Keputusan: kolomnya dihapus, diganti `GET /api/chain-info`** yang membaca `arbiter()` langsung dari kontrak. Satu sumber kebenaran, dan otomatis ikut berubah kalau owner memanggil `setArbiter()` — sementara kolom per-job akan basi seketika.

Endpoint-nya sudah ada (`app/api/chain-info/route.ts`), mengembalikan `oracle`, `arbiter`, `owner`, `bondBps`, `structuralBps`, dan `verifyTimeoutSeconds`. Hasilnya di-cache 60 detik di server: FE memanggilnya di setiap halaman detail, dan tanpa cache itu berarti 6 panggilan RPC per pembukaan halaman.

```ts
// di FE
const { arbiter } = await fetch('/api/chain-info').then(r => r.json());
const bolehMemutus = walletAktif?.toLowerCase() === arbiter?.toLowerCase();
```

### 10.4 Job yang dibuat di luar aplikasi kita

`patch()` memakai `UPDATE ... WHERE job_id = ?`. Kalau ada yang memanggil `createJob()` langsung dari Etherscan atau skrip sendiri, barisnya **tidak ada di database kita** dan update-nya mengenai 0 baris — diam-diam, tanpa error.

Job seperti itu tidak akan pernah muncul di Pasar. Itu bisa diterima (metadata seperti `brand` dan `queries` memang cuma ada di DB kita, tidak on-chain), tapi **harus disadari**: on-chain adalah sumber kebenaran untuk uang, database kita sumber kebenaran untuk metadata, dan job tanpa metadata tidak bisa ditampilkan.

Minimal, catat kejadiannya supaya tidak membingungkan saat debug:

```ts
const { data } = await db().from('jobs').update(fields).eq('job_id', jobId).select('job_id');
if ((data ?? []).length === 0) {
  console.warn(`[indexer] job ${jobId} ada on-chain tapi tidak ada di DB — dibuat di luar aplikasi?`);
}
```

### 10.5 Route

`app/api/sync/[id]/route.ts` dan `app/api/indexer/poll/route.ts` — pakai `parseJobId()` dan `verifyCronSecret()` (keduanya dari Fase 5/6), bukan `Number(id)` dan perbandingan string mentah.

**Kenapa yang satu terbuka dan yang satu tertutup.**

| | `POST /api/sync/:id` | `GET /api/indexer/poll` |
|---|---|---|
| Auth | **tidak ada** | `CRON_SECRET` |
| Cakupan | satu job, satu jendela log | ribuan blok sekali panggil |
| Rate limit | per-job 2 dtk + global 300 ms | — (sudah tertutup auth) |

`sync` sengaja terbuka: ia **tidak menerima data apa pun**, cuma menyuruh backend membaca ulang dari kontrak — dan kontraknya yang jadi sumber kebenaran. Hal terburuk yang bisa dilakukan penyerang adalah memaksa kita menembak RPC, dan itulah yang ditahan dua lapis rate limit. Lapis per-job dibuat longgar (2 detik) karena satu alur normal menghasilkan beberapa panggilan beruntun yang semuanya sah; lapis global menangkap penyapuan banyak `jobId` sekaligus, yang lapis per-job tidak bisa lihat.

`poll` harus tertutup karena cakupannya ribuan blok. `verifyCronSecret()` menolak kalau `CRON_SECRET` kosong — jadi lupa mengisinya saat deploy berarti endpoint **tertutup rapat**, bukan terbuka untuk semua orang.

**`confirmStructural` dipicu dari `sync`, lewat `after()`.** Deliverable yang baru masuk butuh konfirmasi ke kontrak — itu yang mencairkan 20%. Dijalankan setelah respons terkirim karena ia mengirim transaksi dan menunggu receipt, dan user tidak perlu menatap spinner untuk itu.

> Memicu transaksi dari endpoint terbuka terdengar berbahaya, tapi batasnya ada di kontrak, bukan di pemanggil: `confirmStructural` hanya jalan saat status `Submitted`, dan begitu jalan statusnya pindah ke `Verifying`. Panggilan berikutnya tidak menghasilkan transaksi apa pun. Paling banyak **satu transaksi per job**, berapa kali pun endpoint-nya ditembak.

`poll` sekalian memanggil `reclaimStaleLocks()`. Cron adalah satu-satunya hal yang jalan tanpa diminta, jadi di situlah tempatnya: job yang tertinggal di `running_*` karena proses mati di tengah akan menggantung selamanya kalau tidak ada yang memungutnya.

### 10.6 Menjadwalkan cron

`vercel.json` — **sudah ada di repo**, tinggal dipakai saat deploy:

```json
{ "crons": [{ "path": "/api/indexer/poll", "schedule": "*/5 * * * *" }] }
```

> **Verifikasi dulu batas frekuensi cron di plan Vercel kalian.** Plan gratis membatasi seberapa sering cron boleh jalan, dan angkanya berubah dari waktu ke waktu. Kalau terlalu jarang, pakai GitHub Actions (gratis, tiap 5 menit):
>
> ```yaml
> # .github/workflows/indexer.yml
> on:
>   schedule: [{ cron: '*/5 * * * *' }]
> jobs:
>   poll:
>     runs-on: ubuntu-latest
>     steps:
>       - run: curl -sf -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
>                "${{ secrets.APP_URL }}/api/indexer/poll"
> ```
>
> Karena `POST /api/sync/:id` menangani jalur interaktif, frekuensi cron **tidak memengaruhi kualitas demo** — ia hanya jaring pengaman.

**Selesai kalau:** kirim `createJob` dari wallet → panggil `POST /api/sync/0` → job muncul di DB dengan status & budget yang benar, dan satu baris `deposit` di `activity`.

> Baris `deposit` itu muncul karena transaksinya **baru saja** dibuat, jadi log-nya masih ada di jendela 45.000 blok yang dibaca `syncJob`. Kalau kamu menguji job yang dibuat lebih dari ~11 jam lalu, statusnya akan tetap benar tapi baris ledger-nya tidak akan ada — itu pemangkasan RPC (§10.2a), bukan bug.

> **Sebelum menyalakan `CHAIN_ENABLED=true` dengan serius:** hapus data seed. Seed memakai `job_id` 1–6, dan job on-chain sungguhan mulai dari 0 — keduanya akan bertabrakan.


---

## FASE 11 — Pengerasan (≈2 jam)

### 11.1 Header keamanan — `next.config.ts`, BUKAN `proxy.ts`

Rancangan awal menaruh semuanya di `proxy.ts`. Setelah membaca dokumentasi Next.js 16 yang terpasang (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`), pembagiannya diubah:

| Yang dipasang | Di mana | Kenapa |
|---|---|---|
| nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy, HSTS | `next.config.ts` | statis, tidak membaca request |
| `Cache-Control: no-store` untuk `/api` | `next.config.ts` | statis |
| CSP untuk `/api` | `next.config.ts` | statis |
| CORS | `proxy.ts` | **butuh** header `Origin` dari request |
| ~~Rate limit global~~ | **tidak ada** | lihat di bawah |

Tiga alasan header statis tidak berada di proxy:

1. **Urutan eksekusi.** `headers` dari `next.config` berjalan pada langkah 1, proxy baru pada langkah 3. Header di `next.config` tidak bisa terlewat gara-gara matcher yang keliru.
2. Dokumentasinya sendiri: *"Proxy should be used when you need access to request data or more complex logic."* Tidak satu pun header ini membaca request.
3. Berlaku untuk **semua** respons termasuk aset statis, tanpa membuat proxy ikut jalan di tiap permintaan gambar dan CSS.

#### Rate limit global di proxy: dihapus, bukan ditunda

Dokumentasi Next.js menyebutnya eksplisit:

> *"Proxy is meant to be invoked separately of your render code and in optimized cases deployed to your CDN [...] **you should not attempt relying on shared modules or globals**."*

`lib/rate-limit.ts` menyimpan hitungannya di `Map` tingkat-modul. Di proxy, `Map` itu **bukan** `Map` yang sama dengan milik route handler, dan bisa berbeda per node CDN. Hasilnya bukan rate limit — hanya rasa aman yang palsu, yang justru lebih berbahaya daripada tidak ada sama sekali karena orang berhenti mencari perlindungan yang sungguhan.

Pembatasan yang nyata tetap di route masing-masing (`POST /api/jobs` Fase 6, `POST /api/sync/:id` Fase 10), dan pertahanan sebenarnya untuk pekerjaan Oracle adalah **lock atomik di database** — satu-satunya yang berlaku lintas instance.

#### Dua header yang paling mudah terlewat

**`Cache-Control: no-store` untuk `/api`.** Ini baris terpenting di `next.config.ts`. `GET /api/jobs?wallet=0x…` mengembalikan data berbeda per wallet; kalau CDN sempat menyimpannya, wallet berikutnya bisa menerima jawaban milik orang lain. Tidak ada satu pun respons API di proyek ini yang layak di-cache.

**HSTS hanya di produksi.** Kalau ikut terpasang saat pengembangan, browser mengingat "localhost wajib HTTPS" selama dua tahun — dan dev server yang HTTP tidak bisa dibuka lagi sampai dibersihkan manual lewat `chrome://net-internals/#hsts`. Kegagalan yang sangat membingungkan karena tidak ada yang berubah di kode.

#### CORS: default menolak semua

```ts
// proxy.ts
function originYangDiizinkan(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
}
```

Kosong = tidak ada origin yang diizinkan, dan **itu default yang benar**: frontend disajikan Next.js yang sama dengan API-nya, jadi permintaannya same-origin dan tidak pernah melewati CORS sama sekali. Header izin tanpa kebutuhan hanya memperluas permukaan serangan. Isi hanya kalau FE benar-benar dideploy terpisah.

Dua detail yang gampang salah:

- **Preflight harus dijawab tuntas di proxy.** Kalau `OPTIONS` diteruskan ke route, handler kita tidak punya export `OPTIONS` → browser menerima 405 dan membatalkan permintaan aslinya.
- **`Vary: Origin` wajib** setiap kali `Access-Control-Allow-Origin` dipasang. Tanpa itu, cache bisa menyodorkan izin milik origin lain.

#### Verifikasi — header benar-benar terkirim

Diuji terhadap server hidup, bukan dibaca dari konfigurasi:

```
/api/hello      X-Content-Type-Options: nosniff
                Referrer-Policy: strict-origin-when-cross-origin
                X-Frame-Options: SAMEORIGIN
                Permissions-Policy: camera=(), microphone=(), …
                Cache-Control: no-store, max-age=0
                Content-Security-Policy: default-src 'none'; frame-ancestors 'none'; sandbox
/               (empat header pertama, tanpa CSP/no-store)
X-Powered-By    tidak ada  (poweredByHeader: false)
Strict-Transport-Security  tidak ada di dev — benar, produksi saja
```

CORS, enam kasus:

| Kasus | Hasil |
|---|---|
| tanpa `Origin` (same-origin) | 0 header CORS |
| `Origin` asing, `ALLOWED_ORIGINS` kosong | tidak ada `Allow-Origin` |
| preflight `OPTIONS` dari origin asing | 204, tanpa `Allow-Origin` |
| `Origin` terdaftar | `Allow-Origin` + `Vary: Origin` |
| preflight dari origin terdaftar | `Allow-Methods`, `Allow-Headers`, `Max-Age: 86400` |
| origin asing saat daftar terisi | tetap ditolak |

> **CSP untuk HALAMAN sengaja belum dipasang.** CSP yang ketat butuh nonce per-request, dan memasangnya sebelum frontend ada hampir pasti akan memblokir skrip wagmi/RainbowKit dengan pesan yang sulit dilacak. Kerjakan saat halamannya sudah jadi, pakai `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`.

### 11.2 Audit keamanan — checklist yang BERJALAN

```bash
npm run check:security
```

Checklist yang dicentang manusia akan dicentang tanpa dibaca, cepat atau lambat. `scripts/check-security.ts` memeriksanya dengan mesin — **20 pemeriksaan**, dan yang tidak bisa diperiksa mesin disebut terang-terangan di bagian akhir supaya tidak menyamar jadi "aman".

Tidak ada nilai rahasia yang dicetak skrip ini — hanya ada/tidaknya, panjangnya, atau bentuknya. Keluarannya aman ditempel ke chat tim.

| # | Yang diperiksa |
|---|---|
| 1 | Tidak ada rahasia berawalan `NEXT_PUBLIC_` — di env **dan** di source code |
| 1b | anon key kosong & tidak dirujuk kode — konsisten dengan keputusan polling (§3.3) |
| 2 | Tidak ada private key ber-nilai di file yang dilacak git |
| 3 | Semua route memakai `handler()` (pesan error internal tidak bocor) |
| 4 | `POST /api/dev/seed` menolak jalan di produksi |
| 5 | `CRON_SECRET` terisi, bukan nilai contoh, panjang ≥ 24 |
| 6 | Tidak ada `Number()` pada nilai wei |
| 7 | Data seed tidak memakai `jobId` yang bentrok dengan on-chain |
| 8 | Konfigurasi rantai: bentuk private key, RPC bukan drpc, alamat terisi |
| 9 | Header keamanan ada di konfigurasi, `proxy.ts` ada |

Bedanya **GAGAL** dan **!** disengaja: `GAGAL` berarti ada yang salah dan skrip keluar dengan kode 1; `!` berarti keadaan yang sah selama pengembangan tapi harus beres sebelum deploy (`CHAIN_ENABLED` masih false, kunci belum diisi, seed masih ada).

> **Satu pelajaran dari menulis skrip ini.** Versi pertama pemeriksaan #2 mencari pola `0x` + 64 hex di mana saja — dan langsung menuduh dua berkas yang tidak bersalah. Hash verdict, `queryPoolHash`, dan seed VRF semuanya `bytes32`: **bentuknya identik dengan private key**. Pemeriksaan yang berteriak untuk hal normal akan diabaikan orang, dan kebocoran sungguhan ikut terlewat bersamanya. Versi sekarang menuntut nama yang berbau kunci **dan** nilai 64-hex di baris yang sama — diuji dengan 3 kebocoran palsu (semua tertangkap) dan 5 nilai `bytes32` yang sah (semua diabaikan).

#### Yang tetap manual

- Saldo tBNB wallet oracle > 0 — **per 23 Sep 2026 masih 0**
- Env var sudah diisi di panel hosting, bukan cuma di `.env.local`
- Header benar-benar terkirim setelah deploy: `curl -sI https://<app>/api/stats`
- Putaran pertama `/api/indexer/poll`: `blokDilompati` harus jadi `0` di putaran kedua

> **Deploy tanpa `ORACLE_PRIVATE_KEY` tidak merusak apa pun, tapi uang tidak akan bergerak.** Verifikasi tetap berjalan sampai selesai — verdict tersimpan, skor dihitung — lalu settlement gagal dan job berhenti di `job_state='error'`. Begitu kuncinya ditempel, percobaan ulang **hanya** mengirim transaksinya: verdict yang sama dipakai lagi, hash-nya identik, dan **tidak ada satu pun panggilan AI baru** (urutan simpan-dulu-baru-kirim di §8.1). Aman untuk demo bertahap — tapi jangan demo pencairan otomatis sebelum kuncinya masuk.

### 11.3 Dokumentasi API

`api.http` sudah memuat **seluruh** endpoint dengan hasil yang diharapkan tertulis di tiap blok, dan tabel di Bagian 5 lebih berguna daripada Swagger untuk tim tiga orang. Swagger **tidak dikerjakan**, dan itu keputusan — bukan hal yang tertunda.

Alasannya: `next-swagger-doc` menuntut anotasi JSDoc di tiap route yang harus diperbarui manual setiap bentuk respons berubah. Dokumentasi yang bisa basi diam-diam lebih buruk daripada tidak ada, karena orang memercayainya. `api.http` tidak bisa basi diam-diam — ia dijalankan, dan langsung kelihatan kalau jawabannya berubah.

---

# BAGIAN 7 — Yang Harus Kamu Minta ke Tim Lain

## 7.1 Ke orang blockchain — **SELESAI, semua dipenuhi**

> Kontrak sudah di-deploy 13 September 2026 dan **kedelapan permintaan di bawah diterapkan**. Metadata ABI-nya bahkan menulis: *"Bentuk & nama event/`getJob()` mengikuti spek yang dikunci di `geo-escrow-ringkasan-3-bagian.md` §3"* — tim blockchain memakai dokumen ini.
>
> Tabel ini dipertahankan sebagai catatan: kalau kontrak di-deploy ulang, kedelapan hal ini harus tetap ada.

| # | Permintaan | Kenapa |
|---|---|---|
| 1 | **Simpan seed VRF.** Saat `confirmStructural`, simpan `block.prevrandao` dan expose lewat view `verificationSeed(jobId) → bytes32` | Tanpa ini, Oracle memilih subset dengan `Math.random()` di server — bisa curang, dan seluruh premis "VRF" runtuh |
| 2 | **`createJob` cukup menyimpan `bytes32 queryPoolHash`** apa adanya, jangan menghitungnya di Solidity | Backend yang memverifikasi dengan menghitung ulang. Menghindari kerumitan encoding string di Solidity sepenuhnya |
| 3 | **Tambah flag `bool byArbiter` di event `Settled`** | `ArbiterDecided` memang sudah ada, tapi mengandalkan korelasi dua event dalam satu `tx_hash` itu rapuh. Prototipe membedakan `settled_release` dari `jury_release` |
| 4 | **Tambah fungsi `rejectStructural(jobId, reason)`** + event `StructuralRejected` | Kalau structural check gagal dan tidak ada jalan kembali ke `Accepted`, job mati permanen di `Submitted` |
| 4b | **Tambah event `BondSettled(jobId, recipient, amount, slashed)`** | `settleRelease` memindahkan dua jumlah (sisa budget + bond), tapi daftar event lama tidak punya apa pun untuk bond → pergerakan bond tidak akan muncul di halaman Aktivitas |
| 5 | Kirim **ABI** sebagai file JSON, bukan disalin dari Remix | Salah satu karakter di ABI = semua panggilan kontrak gagal dengan pesan yang membingungkan |
| 6 | Konfirmasi nama & tipe argumen tiap event | Indexer memetakan `log.args.xxx` — nama harus persis |
| 7 | Alamat wallet **Arbiter**; apakah bisa diganti lewat `setArbiter`? | Prototipe bilang "siapa pun boleh memutuskan", kontrak membatasi ke satu wallet — FE harus tahu kapan menampilkan panel juri |
| 8 | Satuan `acceptDeadline`: unix detik atau blok? | Kolom DB bertipe `timestamptz` |

## 7.2 Ke dirimu sendiri sebagai FE

| # | Hal | Catatan |
|---|---|---|
| 1 | **Tambahkan field deadline di form Buat Kontrak** | `createJob(queryPoolHash, acceptDeadline)` mewajibkannya, tapi prototipe tidak punya field-nya sama sekali |
| 2 | `lib/hash.ts` **harus identik** dengan yang di backend | Import dari file yang sama, jangan disalin |
| 3 | Urutan submit deliverable: **POST konten dulu, baru tx** | Lihat Fase 7 |
| 4 | Panggil `POST /api/sync/:id` setelah tiap receipt tx | Ini yang membuat UI terasa instan |
| 5 | Panel juri hanya muncul kalau wallet aktif == alamat arbiter | Prototipe menampilkannya ke semua orang. Baca dari **`GET /api/chain-info`** — kolom `jobs.arbiter_addr` sudah dihapus (migrasi 01) karena arbiter adalah nilai tingkat-kontrak |
| 6 | Pakai `deriveUiStatus()`, jangan baca `job.status` mentah | 10 status UI adalah turunan, bukan kolom |
| 7 | Semua wei adalah **string** — jangan `Number()` | Pakai `formatTBNB()` dari `lib/format.ts` |
| 8 | Polling biasa (`setInterval` + refetch), **bukan** Supabase Realtime | Keputusan 2026-09-13 — §3.3 & §3.4 |
| 9 | `jobId` pertama adalah **0**, bukan 1 | Jangan perlakukan 0 sebagai "belum ada" — §9.3 |
| 10 | Baca `requiredBond(jobId)` sebelum `acceptJob` | Nilai `value` harus persis; kontrak menolak kalau meleset |

---

# BAGIAN 8 — Ringkasan Urutan Kerja

| Fase | Isi | Perkiraan | Butuh kontrak? |
|---|---|---|---|
| 0 | Fondasi: env, http helper | 1 jam | — |
| 1 | Database (tanpa RLS/Realtime — §3.3) | 45 mnt | — |
| 2 | Lapisan murni: types, hash, vrf, scoring, verdict | 1,5 jam | — |
| 3 | Repository + seed + 7 endpoint baca | 3 jam | — |
| 4 | Oracle adapter (mock/claude) | 2 jam | — |
| 5 | Baseline resumable | 2,5 jam | — |
| 6 | `POST /api/jobs` hash-gated | 2 jam | — |
| 7 | Deliverable + structural | 2 jam | — |
| 8 | Verifikasi + verdict | 3 jam | — |
| — | **← FE bisa dibangun penuh sampai sini** | | |
| 9 | Chain: baca + jalur tulis | 2 jam | **Ya** — ✅ kode selesai |
| 10 | Indexer + sync | 3 jam | **Ya** — ✅ kode selesai |
| 11 | Pengerasan + dokumentasi | 2 jam | — ✅ kode selesai |

**Total ≈ 25 jam kerja efektif.** Fase 0–8 (≈18 jam) tidak bergantung pada tim blockchain sama sekali — kerjakan itu dulu tanpa menunggu siapa pun.

**Status per 23 Sep 2026:** Fase 0–11 selesai dan teruji. Seluruh backend rampung.

Yang menahan backend dari benar-benar jalan penuh bukan kodenya, melainkan hal-hal di luar backend — jalankan `npm run check:security` untuk melihat mana yang masih merah:

1. `ORACLE_PRIVATE_KEY` untuk `0xa3291638aeE37B076E7CA389C3fd28d5B73a4791` — diserahkan lewat password manager terenkripsi, **tidak pernah lewat chat atau email**. Alternatifnya: owner memanggil `setOracle()` dengan wallet baru yang kuncinya kita pegang.
2. Minimal satu `createJob()` on-chain. `jobCount()` masih 0, jadi belum ada apa pun untuk dibaca atau di-settle.

3. **RPC arsip**, kalau ledger `activity` harus lengkap sejak job pertama. RPC publik memangkas log di ~90.000 blok (~11 jam) — lihat §10.2a. Ini TIDAK menghalangi demo: status dan nilai uang tiap job datang dari `getJob()`, bukan dari log.

Selama (1) dan (2) belum ada, `CHAIN_ENABLED` tetap `false` dan seluruh backend jalan seperti Fase 0–8.

## Urutan uji tiap selesai fase

Semua uji unit sekaligus (tanpa server, tanpa database):

```bash
npm run check           # 3 berkas, semuanya harus gagal: 0
npm run check:security  # audit pra-deploy, 20 pemeriksaan
npx tsc --noEmit
npm run lint
```

Uji alur yang tidak punya endpoint HTTP — dijalankan langsung supaya
tidak perlu menyalakan dev server (Turbopack butuh ratusan MB):

```bash
npx tsx scripts/dev-structural.ts      # Fase 7
npx tsx scripts/dev-verify.ts          # Fase 8
npx tsx scripts/dev-chain-check.ts     # Fase 9 -- ABI vs kontrak hidup   (11)
npx tsx scripts/dev-chain-read.ts      # Fase 9 -- logika pembungkus      (20)
npx tsx scripts/dev-indexer.ts         # Fase 10 -- pemetaan + penyusuran (37)
npx tsx scripts/dev-migration-check.ts # migrasi 01 benar-benar mendarat   (9)
```

Tiga yang terakhir menembak jaringan sungguhan (RPC BSC Testnet dan
Supabase), tapi tidak satu pun mengirim transaksi atau meninggalkan baris
di database. Aman dijalankan kapan saja, termasuk berulang-ulang.

Uji endpoint: buka `api.http` di VS Code (ekstensi REST Client), jalankan
bagian **1. SEED** dulu, lalu bagian yang sesuai fasenya. Tiap blok
menyebut hasil yang diharapkan.

---

# Lampiran — Daftar Environment Variable

| Variabel | Fase | Publik? | Keterangan |
|---|---|---|---|
| `SUPABASE_URL` | 1 | tidak | URL project |
| `SUPABASE_SERVICE_ROLE_KEY` | 1 | **TIDAK PERNAH** | Admin penuh, melewati RLS |
| `NEXT_PUBLIC_SUPABASE_URL` | — | ya | **Belum dipakai** — kita memilih polling. Biarkan kosong |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | — | ya | **Belum dipakai.** Kalau nanti diisi, RLS wajib dinyalakan dulu |
| `ORACLE_PROVIDER` | 4 | tidak | `mock` \| `claude` |
| `ANTHROPIC_API_KEY` | 4 | **TIDAK PERNAH** | |
| `CHAIN_ENABLED` | 9 | tidak | `false` selama Fase 0–8. **Wajib `true` di produksi** — interlock Fase 6 & 7 menolak jalan tanpa itu |
| `RPC_URL` | 9 | tidak | `https://bsc-testnet-rpc.publicnode.com`. Endpoint `data-seed-prebsc-1` **sudah mati** |
| `GEO_ESCROW_ADDRESS` | 9 | tidak | `0x41462F3092Ca66b7B3d9c8b20337793e2756cC46` (BSC Testnet, blok deploy 130.726.113) |
| `ORACLE_PRIVATE_KEY` | 9 | **TIDAK PERNAH** | Wallet khusus, isi seperlunya |
| `CRON_SECRET` | 10 | tidak | String acak panjang |

---

*Dokumen ini menggantikan `geo-escrow-roadmap-backend.md`. Kalau ada fase yang errornya nyangkut, sebut nomor fasenya dan pesan errornya.*
