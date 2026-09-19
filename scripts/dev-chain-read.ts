/**
 * Fase 9 — uji jalur BACA lib/chain-server.ts terhadap kontrak sungguhan.
 *
 * Jalankan: npx tsx scripts/dev-chain-read.ts
 *
 * TIDAK butuh private key dan TIDAK mengirim transaksi apa pun. Semua
 * yang diuji di sini `eth_call` — gratis, tanpa tanda tangan.
 *
 * Bedanya dengan dev-chain-check.ts: yang itu menguji ABI-nya cocok
 * dengan kontrak. Yang ini menguji LOGIKA PEMBUNGKUSNYA — terutama dua
 * hal yang paling gampang salah dan paling mahal akibatnya:
 *
 *   1. null harus berarti "job belum ada", BUKAN "RPC bermasalah"
 *   2. seed nol harus DITOLAK, bukan dipakai mengundi subset
 */
process.loadEnvFile('.env.local');
import { generatePrivateKey } from 'viem/accounts';

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

/** Jalankan fn, kembalikan pesan error-nya (atau null kalau sukses). */
async function pesanError(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function main() {
  console.log('\nFase 9 — jalur baca chain-server\n');

  // Modul diimpor SETELAH loadEnvFile, dan sekali saja: state di dalamnya
  // (cache client, cache assertOracleWallet) sengaja ikut diuji.
  const chain = await import('../lib/chain-server');

  // ── 1. CHAIN_ENABLED=false — mode pengembangan Fase 0-8 ───────────
  console.log('1. CHAIN_ENABLED=false (verifikasi sengaja dilewati)');
  process.env.CHAIN_ENABLED = 'false';
  {
    const job = await chain.readJobFromChain(0n);
    cek('readJobFromChain -> null (dilewati, bukan "tidak ada")', job === null);

    const seed = await chain.getVerificationSeed(7n);
    cek('getVerificationSeed -> seed dev deterministik', /^0x[0-9a-f]{64}$/.test(seed), seed);

    const seedLagi = await chain.getVerificationSeed(7n);
    cek('seed dev stabil untuk jobId yang sama', seed === seedLagi);

    const seedLain = await chain.getVerificationSeed(8n);
    cek('seed dev berbeda untuk jobId berbeda', seed !== seedLain);

    const tx = await chain.settleOnChain(0n, 'release', `0x${'11'.repeat(32)}`);
    cek('settleOnChain -> no-op, tidak menyentuh jaringan', tx.hash === '0xdev');
  }

  // ── 2. CHAIN_ENABLED=true — jalur sungguhan ───────────────────────
  console.log('\n2. CHAIN_ENABLED=true (membaca kontrak hidup)');
  process.env.CHAIN_ENABLED = 'true';

  const info = await chain.readChainInfo();
  cek('readChainInfo terbaca', info.oracle !== null, 'RPC atau alamat kontrak bermasalah');
  console.log(`       kontrak ${info.contractAddress}`);
  console.log(`       oracle  ${info.oracle}`);

  {
    // jobCount() masih 0 selama belum ada yang memanggil createJob().
    // Semua jobId karena itu di luar jangkauan -> null yang SAH.
    const job = await chain.readJobFromChain(999_999n);
    cek('jobId di luar jangkauan -> null (bukan melempar)', job === null);

    const negatif = await chain.readJobFromChain(-1n);
    cek('jobId negatif -> null (tidak dikirim ke RPC)', negatif === null);
  }

  // ── 3. Gerbang seed nol ───────────────────────────────────────────
  console.log('\n3. Gerbang seed nol');
  {
    const err = await pesanError(() => chain.getVerificationSeed(0n));
    cek('seed nol DITOLAK', err !== null, 'seed nol diterima -- subset bisa ditebak!');
    cek(
      'pesannya menyebut confirmStructural',
      (err ?? '').includes('confirmStructural'),
      err ?? ''
    );
  }

  // ── 4. requiredBond ───────────────────────────────────────────────
  //
  // Kontrak TIDAK revert untuk jobId di luar jangkauan — ia membaca
  // struct kosong dan mengembalikan 0. Terbukti langsung dari chain di
  // sini sebelum penjaga dipasang. Nol itu berbahaya: FE akan mengirim
  // acceptJob dengan value 0 dan freelancer membayar gas untuk transaksi
  // yang pasti gagal. Penjaganya yang diuji, bukan kontraknya.
  console.log('\n4. requiredBond — penjaga job yang belum ada');
  {
    const err = await pesanError(() => chain.readRequiredBond(0n));
    cek('job belum ada -> melempar, bukan 0', err !== null, 'mengembalikan angka!');
    cek('pesannya menyebut jobCount', (err ?? '').includes('jobCount'), err ?? '');
  }

  // ── 5. Penjaga private key ────────────────────────────────────────
  // Tidak ada transaksi yang dikirim: keduanya gagal SEBELUM writeContract.
  console.log('\n5. Penjaga private key (tanpa mengirim transaksi)');
  {
    // 5a. Bentuk kunci salah. Sengaja diuji DULU -- walletClient() belum
    //     menyimpan apa pun ke cache saat bentuknya ditolak.
    process.env.ORACLE_PRIVATE_KEY = '0xbukankunci';
    const errBentuk = await pesanError(() =>
      chain.settleOnChain(0n, 'release', `0x${'22'.repeat(32)}`)
    );
    cek('kunci salah bentuk ditolak', errBentuk !== null);
    cek(
      'pesannya menuntun, bukan cuma "invalid"',
      (errBentuk ?? '').includes('64 karakter'),
      errBentuk ?? ''
    );
    cek(
      'pesan TIDAK memuat isi kunci',
      !(errBentuk ?? '').includes('bukankunci'),
      'kunci bocor ke pesan error!'
    );

    // 5b. Kunci sah, tapi bukan wallet oracle. Kunci acak sekali pakai,
    //     tidak pernah memegang dana, tidak pernah ditulis ke mana pun.
    process.env.ORACLE_PRIVATE_KEY = generatePrivateKey();
    const errOracle = await pesanError(() =>
      chain.settleOnChain(0n, 'release', `0x${'33'.repeat(32)}`)
    );
    cek('wallet bukan-oracle ditolak sebelum kirim tx', errOracle !== null);
    cek(
      'pesannya menyarankan setOracle',
      (errOracle ?? '').includes('setOracle'),
      errOracle ?? ''
    );
  }

  console.log('\n----------------------------------------------');
  console.log(`  lulus: ${lulus}   gagal: ${gagal}\n`);
  if (gagal > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\nSKRIP GAGAL:', e);
  process.exitCode = 1;
});
