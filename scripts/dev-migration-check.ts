/**
 * Verifikasi migrasi 01 benar-benar mendarat di database.
 *
 * Jalankan: npx tsx scripts/dev-migration-check.ts
 *
 * Ini bukan membaca file .sql — ini menanyai database yang hidup.
 * Bedanya penting: SQL Editor bisa saja gagal separuh jalan (satu
 * statement error, sisanya tidak jalan) dan kamu tidak menyadarinya.
 *
 * Uji tipe activity dilakukan dengan MENULIS baris sungguhan lalu
 * menghapusnya. Membaca definisi constraint tidak mungkin lewat
 * PostgREST, dan menebak dari nama constraint tidak membuktikan
 * apa pun — hanya INSERT yang membuktikan Postgres benar-benar
 * menerima nilainya.
 */
process.loadEnvFile('.env.local');
import { createClient } from '@supabase/supabase-js';

const db = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

let lulus = 0;
let gagal = 0;

function cek(nama: string, benar: boolean, detail = '') {
  if (benar) {
    lulus++;
    console.log(`  ok   ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${nama}${detail ? ` -- ${detail}` : ''}`);
  }
}

// Tanda pengenal unik, supaya baris uji tidak mungkin tertukar dengan
// data sungguhan kalau penghapusannya gagal.
const TANDA = `migration-check-${Date.now()}`;

async function cobaTipe(type: string, harusDiterima: boolean) {
  const txHash = `0x${TANDA}-${type}`;
  const { data, error } = await db
    .from('activity')
    .insert({
      job_id: null,
      tx_hash: txHash,
      log_index: 0,
      block_number: 0,
      type,
      note: TANDA,
    })
    .select('id');

  const diterima = !error;

  if (diterima) {
    // Bersihkan segera — sebelum assert, supaya baris uji tidak
    // tertinggal kalau assert-nya melempar.
    const id = data?.[0]?.id;
    if (id) await db.from('activity').delete().eq('id', id);
  }

  if (harusDiterima) {
    cek(`tipe '${type}' DITERIMA`, diterima, error?.message ?? '');
  } else {
    cek(
      `tipe '${type}' DITOLAK (constraint masih hidup)`,
      !diterima,
      diterima ? 'constraint hilang -- tipe apa pun lolos!' : ''
    );
  }
}

async function main() {
  console.log('\nVerifikasi migrasi 01\n');

  // ── 1. Kolom arbiter_addr harus hilang ────────────────────────────
  console.log('1. jobs.arbiter_addr dihapus');
  {
    const { error } = await db.from('jobs').select('arbiter_addr').limit(1);
    // PostgREST meneruskan kode Postgres 42703 = undefined_column.
    cek(
      'select arbiter_addr -> error 42703',
      error?.code === '42703',
      error ? `dapat kode ${error.code}` : 'TIDAK error -- kolomnya masih ada'
    );
  }

  // ── 2. Tipe activity baru ─────────────────────────────────────────
  console.log('\n2. Tipe activity');
  await cobaTipe('structural_rejected', true);
  await cobaTipe('dispute_raised', true);
  await cobaTipe('vrf_pick', true); // lama, harus tetap hidup
  await cobaTipe('deposit', true); // lama, harus tetap hidup
  await cobaTipe('tipe_ngawur_xyz', false); // constraint harus menolak

  // ── 3. Bookmark indexer ───────────────────────────────────────────
  console.log('\n3. Bookmark indexer');
  {
    const alamat = (process.env.GEO_ESCROW_ADDRESS ?? '').toLowerCase();
    const { data, error } = await db
      .from('indexer_state')
      .select('contract_addr, last_block_processed')
      .eq('contract_addr', alamat)
      .maybeSingle();

    cek('baris bookmark ada', !error && !!data, error?.message ?? 'tidak ada baris');

    if (data) {
      // last_block_processed adalah bigint -> PostgREST bisa
      // mengirimnya sebagai number ATAU string tergantung besarnya.
      const blok = Number(data.last_block_processed);
      // Nilai semainya 130.726.112, tapi bookmark ini MEMANG bergerak maju
      // setiap runIndexer() jalan -- dan di putaran pertama ia melompat
      // jauh ke horizon pemangkasan RPC (lihat blueprint 10.2a). Jadi yang
      // diuji bukan angka persisnya, melainkan bahwa ia tidak pernah
      // kembali ke 0: itu satu-satunya nilai yang berarti "menyisir dari
      // awal rantai", dan itu yang bikin ribuan permintaan RPC sia-sia.
      cek(
        `bookmark di blok ${blok.toLocaleString('id-ID')} (bukan 0)`,
        blok >= 130726112,
        `dapat ${blok}, lebih tua dari blok semai`
      );
    }
  }

  // ── 4. Tidak ada sampah tertinggal ────────────────────────────────
  console.log('\n4. Kebersihan');
  {
    const { data } = await db.from('activity').select('id').eq('note', TANDA);
    cek('baris uji sudah terhapus semua', (data ?? []).length === 0, `sisa ${data?.length}`);
  }

  console.log('\n----------------------------------------------');
  console.log(`  lulus: ${lulus}   gagal: ${gagal}\n`);
  if (gagal > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\nSKRIP GAGAL:', e);
  process.exitCode = 1;
});
