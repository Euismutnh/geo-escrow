/**
 * Alat bantu pengembangan: menjalankan alur verifikasi (Fase 8) langsung,
 * tanpa lewat HTTP.
 *
 * Jalankan: npx tsx scripts/dev-verify.ts
 *
 * Sengaja tidak lewat dev server: `next dev` memakai Turbopack yang butuh
 * ratusan MB, dan di mesin dengan RAM terbatas itu bisa gagal alokasi.
 * Skrip ini cuma memuat lib/ yang dipakai, jadi ringan.
 *
 * MENGUBAH data job 4. Jalankan POST /api/dev/seed setelah selesai.
 */
process.loadEnvFile('.env.local');
import { db } from '../lib/db';
import { getJob } from '../lib/jobs-repo';
import { runVerification } from '../lib/flows/verify';
import { verdictHash, canonicalVerdict, type Verdict } from '../lib/verdict';
import { deriveSubset, subsetSize } from '../lib/vrf';
import { decide } from '../lib/scoring';
import { ApiError } from '../lib/http';

const JOB = 4;

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`    ok   ${name}`); }
  else { fail++; console.error(`    FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const show = (label: string, v: unknown) =>
  console.log('    ' + label.padEnd(32) + JSON.stringify(v));
const line = () => console.log('  ' + '-'.repeat(60));

/** Kembalikan job 4 ke kondisi siap diverifikasi. */
async function reset() {
  await db().from('oracle_runs').delete().eq('job_id', JOB).eq('phase', 'verification');
  await db().from('jobs').update({
    status: 'Verifying',
    job_state: 'idle',
    last_error: null,
    verification_seed: null,
    verification_subset: null,
    verification_score: null,
    verification_of: null,
    verification_decision: null,
    verification_at: null,
    verdict_hash: null,
    verdict_json: null,
  }).eq('job_id', JOB);
}

async function main() {
  console.log('\nSIAPKAN: job 4 (Jamu Sehat) status Verifying, punya deliverable');
  await reset();
  const awal = await getJob(JOB);
  show('queries / target', `${awal.queries.length} / ${awal.target_count}`);
  show('deliverable', `${awal.deliverable_content?.length} char`);

  line();
  console.log('  1. Verifikasi pertama');
  const r1 = await runVerification(JOB);
  show('hasil', r1);
  check('mengembalikan decision', ['release', 'refund', 'dispute'].includes(r1.decision));
  check('subset terisi', r1.subset.length > 0);
  check('verdictHash format keccak256', /^0x[0-9a-f]{64}$/.test(r1.verdictHash));
  check('resumedSettlement = false', r1.resumedSettlement === false);
  check('settledOnChain = false (chain mati)', r1.settledOnChain === false);

  const j1 = await getJob(JOB);
  check('job_state kembali idle', j1.job_state === 'idle', j1.job_state);
  check('verification_decision tersimpan', j1.verification_decision === r1.decision);
  check('verdict_json tersimpan', j1.verdict_json !== null);
  check('verification_of = ukuran subset', j1.verification_of === r1.subset.length);

  line();
  console.log('  2. Verifikasi kedua -> harus DITOLAK (sudah diverifikasi)');
  try {
    await runVerification(JOB);
    check('ditolak', false, 'malah berhasil lagi');
  } catch (e) {
    check('ditolak dengan ApiError', e instanceof ApiError);
    check('kodenya WRONG_STATUS', (e as ApiError).code === 'WRONG_STATUS',
      (e as ApiError).code);
    show('pesan', (e as ApiError).message);
  }

  line();
  console.log('  3. AUDIT: verdict bisa dihitung ulang pihak luar?');
  const v = (await getJob(JOB)).verdict_json as Verdict;

  const subsetUlang = deriveSubset(v.seed as `0x${string}`, v.n, subsetSize(v.n));
  check('subset bisa diturunkan ulang dari seed',
    JSON.stringify(subsetUlang) === JSON.stringify(v.subset),
    `${JSON.stringify(subsetUlang)} vs ${JSON.stringify(v.subset)}`);

  const decisionUlang = decide({ score: v.score, of: v.of, target: v.target, n: v.n });
  check('keputusan bisa dihitung ulang', decisionUlang === v.decision);

  const hashUlang = verdictHash(v);
  check('hash cocok dengan yang tersimpan',
    hashUlang.toLowerCase() === String((await getJob(JOB)).verdict_hash).toLowerCase());

  console.log('    string kanonik (baris pertama):');
  console.log('      ' + canonicalVerdict(v).split('\n').slice(0, 4).join(' | '));

  line();
  console.log('  4. SKENARIO PEMBAYARAN GANDA');
  console.log('     Verdict sudah tersimpan tapi settlement gagal.');
  console.log('     Percobaan ulang HARUS memakai verdict yang sama,');
  console.log('     BUKAN menghitung ulang dan menyetel ulang dari nol.');

  const hashSebelum = (await getJob(JOB)).verdict_hash;
  const runsSebelum = await hitungRuns();

  // Simulasikan: settlement gagal -> job_state jadi 'error'
  await db().from('jobs').update({ job_state: 'error', last_error: 'Simulasi: settle gagal' }).eq('job_id', JOB);

  const r2 = await runVerification(JOB);
  show('hasil', { decision: r2.decision, resumedSettlement: r2.resumedSettlement });
  check('ditandai resumedSettlement', r2.resumedSettlement === true);
  check('verdictHash IDENTIK dengan sebelumnya',
    r2.verdictHash.toLowerCase() === String(hashSebelum).toLowerCase());
  check('TIDAK ada panggilan AI baru', (await hitungRuns()) === runsSebelum,
    `${await hitungRuns()} vs ${runsSebelum}`);

  const j2 = await getJob(JOB);
  check('job_state kembali idle', j2.job_state === 'idle', j2.job_state);

  line();
  console.log('  5. Status salah -> ditolak');
  await db().from('jobs').update({ status: 'Accepted', job_state: 'idle' }).eq('job_id', JOB);
  try {
    await runVerification(JOB);
    check('ditolak saat status Accepted', false, 'malah jalan');
  } catch (e) {
    check('ditolak saat status Accepted', e instanceof ApiError);
    show('pesan', (e as ApiError).message);
  }

  line();
  console.log(`  lulus: ${pass}   gagal: ${fail}`);
  console.log('\n  Pulihkan data: POST http://localhost:3000/api/dev/seed');
  console.log('  (atau jalankan ulang skrip ini -- ia me-reset job 4 sendiri)\n');
  process.exit(fail ? 1 : 0);
}

async function hitungRuns(): Promise<number> {
  const { count } = await db()
    .from('oracle_runs')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', JOB)
    .eq('phase', 'verification');
  return count ?? 0;
}

main();
