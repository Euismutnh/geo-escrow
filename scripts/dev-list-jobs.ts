/**
 * Uji listJobs() terhadap Supabase SUNGGUHAN — halaman di luar jangkauan.
 *
 * Jalankan: npx tsx scripts/dev-list-jobs.ts
 *
 * HANYA MEMBACA. Tidak menulis, tidak memanggil AI, tidak menyentuh chain.
 *
 * Kenapa perlu uji ke database, bukan uji murni: bug-nya milik PostgREST.
 * Offset yang MELEWATI jumlah baris dibalas HTTP 416 (PGRST103) tanpa
 * `count`; offset yang TEPAT sama dengan jumlah baris masih sukses. Dulu
 * listJobs() meneruskan error itu sebagai 500 — GET /api/jobs?page=99
 * membalas "Requested range not satisfiable". Perilaku ini hanya bisa
 * dibuktikan terhadap PostgREST yang sesungguhnya.
 */
process.loadEnvFile('.env.local');

let lulus = 0;
let gagal = 0;
function cek(nama: string, ok: boolean, info = '') {
  if (ok) { lulus++; console.log(`  ok   ${nama}`); }
  else { gagal++; console.error(`  FAIL ${nama}${info ? ` -- ${info}` : ''}`); }
}

async function main() {
  const { listJobs } = await import('../lib/jobs-repo');

  console.log('\nlistJobs - halaman di luar jangkauan (database sungguhan)');

  const semua = await listJobs({ page: 1, limit: 50 });
  const N = semua.total;
  cek(`halaman 1 terbaca (total ${N})`, semua.jobs.length === Math.min(N, 50));

  // Batas yang diukur: offset == total masih sukses (206).
  if (N > 0) {
    const tepat = await listJobs({ page: 2, limit: N });
    cek('offset TEPAT = total -> daftar kosong, total utuh', tepat.jobs.length === 0 && tepat.total === N, JSON.stringify({ n: tepat.jobs.length, total: tepat.total }));
  }

  const jauh = await listJobs({ page: 99, limit: 24 });
  cek('halaman 99 -> tidak melempar, daftar kosong', jauh.jobs.length === 0);
  cek('halaman 99 -> total SAMA dengan halaman 1', jauh.total === N, `dapat ${jauh.total}, ingin ${N}`);
  cek('halaman 99 -> page & limit dikembalikan apa adanya', jauh.page === 99 && jauh.limit === 24);

  // Kueri hitung pengganti harus memakai filter yang SAMA.
  for (const filter of ['open', 'progress', 'dispute', 'done'] as const) {
    const p1 = await listJobs({ filter, page: 1, limit: 1 });
    const p9 = await listJobs({ filter, page: 9999, limit: 24 });
    cek(`filter=${filter}: total di luar jangkauan = total halaman 1 (${p1.total})`, p9.total === p1.total && p9.jobs.length === 0, `dapat ${p9.total}`);
  }

  const wallet = semua.jobs[0]?.client_addr;
  if (wallet) {
    const w1 = await listJobs({ wallet, page: 1, limit: 1 });
    const w9 = await listJobs({ wallet, page: 500, limit: 24 });
    cek(`wallet ${wallet.slice(0, 8)}…: total di luar jangkauan = ${w1.total}`, w9.total === w1.total && w9.jobs.length === 0, `dapat ${w9.total}`);
  }

  console.log('\n' + '-'.repeat(46));
  console.log(`  lulus: ${lulus}   gagal: ${gagal}`);
  process.exit(gagal ? 1 : 0);
}

main().catch((e) => { console.error('  FAIL melempar:', e); process.exit(1); });
