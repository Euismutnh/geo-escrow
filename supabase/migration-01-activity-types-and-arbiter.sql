-- ============================================================
-- Migrasi 01 — dijalankan di Supabase → SQL Editor → Run
--
-- Dua perubahan, keduanya buntut dari ABI kontrak yang sudah final:
--
--   1. Tambah dua tipe activity yang dibutuhkan event baru.
--   2. Hapus kolom jobs.arbiter_addr yang tidak pernah terisi.
--
-- Aman dijalankan ulang (idempoten).
-- ============================================================


-- ------------------------------------------------------------
-- 1. Tipe activity baru
--
-- Kontrak memancarkan dua event yang belum punya tempat di ledger:
--
--   StructuralRejected  -> oracle menolak deliverable, job kembali
--                          ke 'Accepted' supaya bisa submit ulang
--   DisputeRaised       -> skor di zona abu, dilempar ke juri
--
-- Rancangan awal memetakan DisputeRaised ke 'vrf_pick', yang salah
-- arti: vrf_pick menandakan pemilihan subset pertanyaan, bukan
-- sengketa. 'vrf_pick' tetap dipertahankan karena masih dipakai
-- prototipe untuk mencatat pemilihan subset.
-- ------------------------------------------------------------
alter table activity drop constraint if exists activity_type_check;

alter table activity add constraint activity_type_check check (type in (
  'deposit',
  'bond_lock',
  'structural_release',
  'structural_rejected',   -- BARU: event StructuralRejected
  'dispute_raised',        -- BARU: event DisputeRaised
  'vrf_pick',
  'final_release',
  'final_refund',
  'jury_release',
  'jury_refund',
  'bond_return',
  'bond_slash',
  'reclaim'
));


-- ------------------------------------------------------------
-- 2. Hapus jobs.arbiter_addr
--
-- Kolom ini tidak pernah ditulis oleh kode mana pun, dan memang
-- tidak seharusnya: arbiter adalah nilai TINGKAT-KONTRAK (fungsi
-- `arbiter()`), bukan properti per-job. Menyimpannya per baris
-- berarti nilainya jadi basi begitu owner memanggil setArbiter().
--
-- Penggantinya: GET /api/chain-info, yang membaca arbiter()
-- langsung dari kontrak.
-- ------------------------------------------------------------
alter table jobs drop column if exists arbiter_addr;


-- ------------------------------------------------------------
-- 3. Semai bookmark indexer
--
-- Tanpa baris ini, indexer mulai dari blok 0. Kontrak di-deploy
-- pada blok 130.726.113, dan tiap putaran memproses 2.000 blok --
-- artinya ~65.000 permintaan RPC menyisir blok kosong sebelum
-- sampai ke event pertama. Berjam-jam, dan hampir pasti kena
-- rate limit RPC publik.
--
-- 130726112 = satu blok SEBELUM deploy, supaya blok deploy sendiri
-- ikut terbaca.
-- ------------------------------------------------------------
insert into indexer_state (contract_addr, last_block_processed)
values (lower('0x41462F3092Ca66b7B3d9c8b20337793e2756cC46'), 130726112)
on conflict (contract_addr) do nothing;


-- ------------------------------------------------------------
-- Verifikasi — jalankan setelahnya, semua harus mengembalikan baris
-- ------------------------------------------------------------
-- select conname from pg_constraint where conname = 'activity_type_check';
-- select column_name from information_schema.columns
--   where table_name = 'jobs' and column_name = 'arbiter_addr';   -- harus KOSONG
-- select * from indexer_state;
