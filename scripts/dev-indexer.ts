/**
 * Fase 10 — uji indexer.
 *
 * Jalankan: npx tsx scripts/dev-indexer.ts
 *
 * Dua bagian:
 *
 *   A. Pemetaan event -> baris ledger. Murni, tanpa jaringan dan tanpa
 *      database. Di sinilah temuan #1 (`log.args.freelancer` yang tidak
 *      ada) dan #4 (BondSettled terlewat) dikunci supaya tidak kembali.
 *
 *   B. Jalur hidup terhadap BSC Testnet. Tidak mengirim transaksi apa pun;
 *      satu-satunya yang ditulis ke database adalah bookmark indexer —
 *      dan itu memang gunanya, jadi menjalankan skrip ini sekaligus
 *      memajukan penyusuran.
 */
process.loadEnvFile('.env.local');
import {
  jobIdDari,
  keBarisActivity,
  runIndexer,
  syncJob,
  DEPLOY_BLOCK,
  type LogTerurai,
} from '../lib/indexer';
import type { OnChainJob } from '../lib/chain-server';

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

const KONTRAK = (process.env.GEO_ESCROW_ADDRESS ?? '').toLowerCase();
const FREELANCER = '0xF77e1c1a2Bb0eA9F1a1b2c3D4e5F6a7B8c9D0e1F';
const CLIENT = '0x71C7656EC7ab88b098defB751B7401B5f6d8976F';

/** Bentuk log palsu — cukup field yang benar-benar dibaca indexer. */
function log(eventName: string, args: Record<string, unknown>): LogTerurai {
  return {
    eventName,
    args,
    blockNumber: 130_726_200n,
    logIndex: 0,
    transactionHash: `0x${'ab'.repeat(32)}`,
  } as unknown as LogTerurai;
}

const JOB_ONCHAIN = {
  freelancer: FREELANCER,
  client: CLIENT,
  status: 3,
} as unknown as OnChainJob;

function bagianA() {
  console.log('\nA. Pemetaan event -> baris ledger (murni)\n');

  // ── jobId: sentinelnya tidak boleh 0 ──────────────────────────────
  console.log('1. jobId — job 0 itu job yang SAH');
  cek('jobId 0n -> 0, bukan null', jobIdDari(log('JobCreated', { jobId: 0n })) === 0);
  cek(
    'event tingkat-kontrak -> null',
    jobIdDari(log('OracleChanged', { oldOracle: CLIENT, newOracle: FREELANCER })) === null
  );
  cek('args kosong -> null', jobIdDari(log('Apa', {})) === null);

  // ── StructuralConfirmed: temuan #1 dan #2 ─────────────────────────
  console.log('\n2. StructuralConfirmed — event TIDAK membawa `freelancer`');
  {
    const l = log('StructuralConfirmed', {
      jobId: 3n,
      amount: 4_000_000_000_000_000n,
      seed: `0x${'cd'.repeat(32)}`,
    });

    const dgn = keBarisActivity(l, JOB_ONCHAIN);
    cek('type structural_release', dgn?.type === 'structural_release', dgn?.type);
    cek('amount dari event', dgn?.amount_wei === '4000000000000000', dgn?.amount_wei ?? '');
    cek(
      'to_addr diambil dari KONTRAK, bukan dari event',
      dgn?.to_addr === FREELANCER.toLowerCase(),
      dgn?.to_addr ?? 'null'
    );
    cek('to_addr tidak pernah "undefined"', dgn?.to_addr !== 'undefined');

    // Kalau job belum terbaca dari chain, penerimanya null -- BUKAN string
    // "undefined", yang dulu masuk ke kolom dan bikin UI menampilkan
    // pencairan tanpa penerima.
    const tanpa = keBarisActivity(l, null);
    cek('tanpa data on-chain -> to_addr null', tanpa?.to_addr === null, String(tanpa?.to_addr));
  }

  // ── Settled: empat cabang ─────────────────────────────────────────
  console.log('\n3. Settled — empat cabang, dibedakan `byArbiter`');
  {
    const buat = (toFreelancer: boolean, byArbiter: boolean) =>
      keBarisActivity(
        log('Settled', {
          jobId: 1n,
          toFreelancer,
          byArbiter,
          recipient: FREELANCER,
          amount: 16_000_000_000_000_000n,
          verdictHash: `0x${'11'.repeat(32)}`,
        }),
        JOB_ONCHAIN
      );

    cek('oracle + release -> final_release', buat(true, false)?.type === 'final_release');
    cek('oracle + refund  -> final_refund', buat(false, false)?.type === 'final_refund');
    cek('juri   + release -> jury_release', buat(true, true)?.type === 'jury_release');
    cek('juri   + refund  -> jury_refund', buat(false, true)?.type === 'jury_refund');
    cek(
      'recipient disimpan huruf kecil',
      buat(true, false)?.to_addr === FREELANCER.toLowerCase()
    );
  }

  // ── BondSettled: temuan #4 ────────────────────────────────────────
  console.log('\n4. BondSettled — tanpa ini bond_return/bond_slash kosong selamanya');
  {
    const buat = (slashed: boolean) =>
      keBarisActivity(
        log('BondSettled', {
          jobId: 1n,
          recipient: FREELANCER,
          amount: 1_000_000_000_000_000n,
          slashed,
        }),
        JOB_ONCHAIN
      );

    cek('slashed true  -> bond_slash', buat(true)?.type === 'bond_slash');
    cek('slashed false -> bond_return', buat(false)?.type === 'bond_return');
    cek('amount terbawa', buat(false)?.amount_wei === '1000000000000000');
  }

  // ── StructuralRejected: temuan #3 ─────────────────────────────────
  console.log('\n5. StructuralRejected');
  {
    const panjang = 'x'.repeat(500);
    const b = keBarisActivity(log('StructuralRejected', { jobId: 2n, reason: panjang }), null);
    cek('type structural_rejected', b?.type === 'structural_rejected');
    cek('alasan dipotong di 200 karakter', b?.note?.length === 200, String(b?.note?.length));
  }

  // ── Event yang memang TIDAK dicatat ───────────────────────────────
  console.log('\n6. Event yang sengaja tidak masuk ledger');
  cek(
    'DeliverableSubmitted -> null (tidak ada uang bergerak)',
    keBarisActivity(log('DeliverableSubmitted', { jobId: 1n, deliverableHash: '0x00' }), null) ===
      null
  );
  cek(
    'ArbiterDecided -> null (Settled di tx yang sama sudah mencatatnya)',
    keBarisActivity(log('ArbiterDecided', { jobId: 1n, toFreelancer: true }), null) === null
  );
  cek(
    'event tak dikenal -> null, bukan melempar',
    keBarisActivity(log('EventMasaDepan', { jobId: 1n }), null) === null
  );

  // ── Deposit & reclaim ─────────────────────────────────────────────
  console.log('\n7. JobCreated / JobAccepted / Reclaimed');
  {
    const dep = keBarisActivity(
      log('JobCreated', {
        jobId: 0n,
        client: CLIENT,
        budget: 20_000_000_000_000_001n, // ganjil, di ATAS 2^53
        queryPoolHash: `0x${'22'.repeat(32)}`,
        acceptDeadline: 1_790_000_000n,
      }),
      null
    );
    cek('deposit: type', dep?.type === 'deposit');
    cek(
      'wei di atas 2^53 utuh (String, bukan Number)',
      dep?.amount_wei === '20000000000000001',
      dep?.amount_wei ?? ''
    );
    cek('deposit: tujuan = alamat kontrak', dep?.to_addr === KONTRAK, dep?.to_addr ?? '');

    const acc = keBarisActivity(
      log('JobAccepted', { jobId: 0n, freelancer: FREELANCER, bond: 1n }),
      null
    );
    cek('bond_lock: type', acc?.type === 'bond_lock');
    cek('bond_lock: asal = freelancer', acc?.from_addr === FREELANCER.toLowerCase());

    const rec = keBarisActivity(
      log('Reclaimed', { jobId: 0n, client: CLIENT, amount: 5n }),
      null
    );
    cek('reclaim: type', rec?.type === 'reclaim');
    cek('reclaim: tujuan = client', rec?.to_addr === CLIENT.toLowerCase());
  }
}

async function bagianB() {
  console.log('\n\nB. Jalur hidup (BSC Testnet — tanpa mengirim transaksi)\n');

  process.env.CHAIN_ENABLED = 'true';

  // ── syncJob untuk job yang belum ada ──────────────────────────────
  console.log('1. syncJob untuk job yang belum ada di kontrak');
  {
    const h = await syncJob(0);
    cek('tidak melempar', true);
    cek('adaDiChain false', h.adaDiChain === false);
    cek('nol log', h.logs === 0, String(h.logs));
    cek('nol baris ledger baru', h.activityBaru === 0, String(h.activityBaru));
  }

  // ── runIndexer ────────────────────────────────────────────────────
  console.log('\n2. runIndexer — satu putaran penyusuran');
  {
    const t0 = Date.now();
    const h = await runIndexer();
    const ms = Date.now() - t0;

    cek('rentang diproses > 0', h.rentangDiproses > 0, String(h.rentangDiproses));
    cek('bookmark maju', BigInt(h.sampaiBlok) > DEPLOY_BLOCK, h.sampaiBlok);
    cek(
      'tidak melewati ujung rantai (jarak aman reorg)',
      BigInt(h.sampaiBlok) < BigInt(h.tipRantai),
      `${h.sampaiBlok} vs ${h.tipRantai}`
    );

    const sisa = BigInt(h.tipRantai) - BigInt(h.sampaiBlok);
    console.log(`       ${h.dariBlok} -> ${h.sampaiBlok}  (${h.rentangDiproses} rentang, ${ms}ms)`);
    console.log(`       sisa ke ujung rantai: ${sisa.toLocaleString('id-ID')} blok`);
    console.log(`       masihAdaSisa: ${h.masihAdaSisa}`);

    if (h.blokDilompati !== '0') {
      console.log(`       DILOMPATI: ${Number(h.blokDilompati).toLocaleString('id-ID')} blok (log sudah dipangkas RPC)`);
    }

    // Panggilan kedua harus MELANJUTKAN, bukan mengulang dari awal --
    // inilah yang membuktikan bookmark tersimpan per rentang.
    const h2 = await runIndexer();
    cek(
      'panggilan kedua melanjutkan, bukan mengulang',
      BigInt(h2.dariBlok) === BigInt(h.sampaiBlok) + 1n,
      `${h2.dariBlok} vs harusnya ${BigInt(h.sampaiBlok) + 1n}`
    );
    // Lompatan pemangkasan hanya boleh terjadi SEKALI. Kalau terulang,
    // bookmark tidak tersimpan dan tiap putaran akan membuang rentang lagi.
    cek(
      'lompatan pemangkasan tidak terulang',
      h2.blokDilompati === '0',
      h2.blokDilompati
    );
  }
}

async function main() {
  bagianA();
  await bagianB();

  console.log('\n----------------------------------------------');
  console.log(`  lulus: ${lulus}   gagal: ${gagal}\n`);
  if (gagal > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\nSKRIP GAGAL:', e);
  process.exitCode = 1;
});
