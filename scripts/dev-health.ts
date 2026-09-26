/**
 * Pemeriksaan kesehatan sistem — HANYA MEMBACA (Fase 10, observabilitas).
 *
 * Jalankan:  npx tsx scripts/dev-health.ts
 *
 * Tidak menulis database, tidak mengirim transaksi, tidak memanggil AI.
 * Dipakai sebelum & selama demo untuk menjawab "ada yang macet?" tanpa
 * membuka Supabase atau BscScan:
 *   - job yang `error`, atau `running_*`/`queued_*` lebih dari 3 menit
 *   - job yang status DB-nya BERBEDA dari kontrak (sync tertinggal)
 *   - saldo gas wallet Oracle & arbiter
 *   - ketertinggalan bookmark indexer dari ujung rantai
 *   - pemakaian kuota AI 24 jam (lib/oracle/runner.ts)
 * Keluar dengan kode 1 kalau ada temuan yang butuh tindakan.
 */
process.loadEnvFile('.env.local');

async function main() {
  const { db } = await import('../lib/db');
  const { env } = await import('../lib/env');
  const { publicClient, escrowAddress, readJobFromChain, readChainInfo } = await import('../lib/chain-server');
  const { STATUS_BY_INDEX } = await import('../lib/abi');
  const { isStaleLock } = await import('../lib/status');
  const { formatEther } = await import('viem');

  const masalah: string[] = [];
  const catat = (ok: boolean, teks: string) => {
    console.log(`  ${ok ? 'ok  ' : 'PERLU'} ${teks}`);
    if (!ok) masalah.push(teks);
  };

  console.log(`\nGEO Escrow — kesehatan sistem (${new Date().toLocaleString('id-ID')})`);
  console.log(`  kontrak ${escrowAddress()} · CHAIN_ENABLED=${env.chainEnabled} · ORACLE_PROVIDER=${env.oracleProvider}\n`);

  // ---- 1. job macet / error ----
  console.log('1. Kerja Oracle');
  const { data: jobs, error } = await db()
    .from('jobs')
    .select('job_id, brand, status, job_state, job_state_at, last_error')
    .order('job_id');
  if (error) throw new Error(`membaca jobs: ${error.message}`);
  const now = Date.now();
  const bermasalah = (jobs ?? []).filter((j) => j.job_state === 'error' || isStaleLock(j, now));
  catat(bermasalah.length === 0, `job error/macet: ${bermasalah.length}`);
  for (const j of bermasalah) console.log(`        #${j.job_id} ${j.brand} · ${j.status}/${j.job_state} · ${j.last_error ?? '(tanpa pesan)'}`);

  // ---- 2. DB vs chain ----
  console.log('\n2. Status database vs kontrak');
  if (!env.chainEnabled) {
    console.log('  --   dilewati (CHAIN_ENABLED=false)');
  } else {
    const aktif = (jobs ?? []).filter((j) => j.status !== 'ReleasedFull' && j.status !== 'Refunded');
    let beda = 0;
    for (const j of aktif) {
      const oc = await readJobFromChain(BigInt(j.job_id));
      const onChain = oc ? STATUS_BY_INDEX[Number(oc.status)] : '(tidak ada di kontrak)';
      if (onChain !== j.status) { beda++; console.log(`        #${j.job_id} DB=${j.status} kontrak=${onChain}`); }
    }
    catat(beda === 0, `job aktif diperiksa: ${aktif.length}, status berbeda: ${beda}${beda ? ' → POST /api/sync/:id atau jalankan poll' : ''}`);
  }

  // ---- 3. saldo gas ----
  console.log('\n3. Saldo gas');
  if (env.chainEnabled) {
    const info = await readChainInfo();
    // 0,0005 tBNB: satu putusan arbiter ±0,0000073 tBNB (job #1), satu tx Oracle
    // sedikit lebih — ambang ini masih puluhan transaksi.
    const MIN = 500_000_000_000_000n;
    for (const [nama, alamat] of [['Oracle', info.oracle], ['Arbiter', info.arbiter]] as const) {
      if (!alamat) { catat(false, `${nama}: alamat tidak terbaca`); continue; }
      const bal = await publicClient().getBalance({ address: alamat as `0x${string}` });
      catat(bal >= MIN, `${nama} ${alamat.slice(0, 8)}…: ${formatEther(bal)} tBNB${bal < MIN ? ' (di bawah 0,0005 — isi dari faucet)' : ''}`);
    }
  } else console.log('  --   dilewati (CHAIN_ENABLED=false)');

  // ---- 4. indexer ----
  console.log('\n4. Indexer');
  if (env.chainEnabled) {
    const { data: bm } = await db().from('indexer_state').select('last_block_processed, updated_at').eq('contract_addr', escrowAddress().toLowerCase()).maybeSingle();
    const tip = await publicClient().getBlockNumber();
    if (!bm) catat(false, 'bookmark indexer belum ada — poll belum pernah jalan');
    else {
      const lag = Number(tip) - Number(bm.last_block_processed);
      // ±0,45 dtk/blok: 2.000 blok ≈ 15 menit. Status job tidak bergantung
      // pada ini (sync langsung), hanya ledger dari transaksi pihak luar.
      catat(lag < 2_000, `tertinggal ${lag.toLocaleString('id-ID')} blok (±${Math.round((lag * 0.45) / 60)} menit) · terakhir ${new Date(bm.updated_at).toLocaleString('id-ID')}${lag >= 2_000 ? ' → cron belum jalan: GET /api/indexer/poll (Bearer CRON_SECRET). Status job TIDAK terpengaruh; hanya ledger transaksi dari luar aplikasi' : ''}`);
    }
  } else console.log('  --   dilewati (CHAIN_ENABLED=false)');

  // ---- 5. kuota AI ----
  console.log('\n5. Kuota AI 24 jam');
  const since = new Date(now - 24 * 60 * 60_000).toISOString();
  const { count } = await db().from('oracle_runs').select('id', { count: 'exact', head: true }).gte('created_at', since).not('model', 'like', 'mock%');
  const pakai = count ?? 0;
  catat(pakai < env.oracleDailyCallLimit * 0.8, `panggilan AI sungguhan: ${pakai} dari ${env.oracleDailyCallLimit}`);

  console.log(`\n${masalah.length === 0 ? 'SEHAT — tidak ada yang perlu ditindak.' : `${masalah.length} hal perlu ditindak.`}\n`);
  process.exitCode = masalah.length === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error(`\n  GAGAL: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}\n`);
  process.exitCode = 1;
});

export {}; // modul, bukan skrip global — `main` tidak bentrok dengan skrip lain
