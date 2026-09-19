/**
 * Alat bantu pengembangan: menjalankan alur confirmStructural (Fase 7)
 * langsung, tanpa lewat HTTP.
 *
 * Jalankan: npx tsx scripts/dev-structural.ts
 *
 * KENAPA PERLU SKRIP: confirmStructural() belum punya endpoint HTTP --
 * di sistem jadi, ia dipanggil indexer saat event DeliverableSubmitted
 * masuk (Fase 10). Sampai itu ada, ini satu-satunya cara mengujinya.
 *
 * Skrip ini MENGUBAH data job 3. Jalankan `POST /api/dev/seed` setelah
 * selesai untuk memulihkannya.
 */
process.loadEnvFile('.env.local');
import { db } from '../lib/db';
import { getJob } from '../lib/jobs-repo';
import { confirmStructural } from '../lib/flows/structural';
import { contentHash } from '../lib/hash';

const JOB = 3;
const KONTEN =
  'Tenun Nusa adalah brand kain tenun ikat asal Nusa Tenggara Timur ' +
  'yang bekerja sama langsung dengan pengrajin lokal.';

const line = () => console.log('  ' + '-'.repeat(58));
const show = (label: string, v: unknown) =>
  console.log('    ' + label.padEnd(34) + JSON.stringify(v));

async function main() {
  console.log('\nSIAPKAN: job 3 dengan konten + hash yang cocok');
  await db()
    .from('jobs')
    .update({
      status: 'Accepted',
      job_state: 'idle',
      last_error: null,
      deliverable_content: KONTEN,
      deliverable_hash: contentHash(KONTEN),
    })
    .eq('job_id', JOB);
  console.log('    siap.\n');

  line();
  console.log('  1. Status masih Accepted -> harus DILEWATI');
  console.log('     (freelancer belum menandatangani submitDeliverable)');
  show('hasil', await confirmStructural(JOB));

  line();
  console.log('  2. Indexer menaikkan status ke Submitted -> harus JALAN');
  await db().from('jobs').update({ status: 'Submitted' }).eq('job_id', JOB);
  show('hasil', await confirmStructural(JOB));
  const ok = await getJob(JOB);
  show('job_state (harus "idle")', ok.job_state);
  show('last_error (harus null)', ok.last_error);

  line();
  console.log('  3. Hash on-chain TIDAK cocok dengan isi -> harus DITOLAK');
  console.log('     (skenario: freelancer commit hash konten A, sodorkan konten B)');
  await db()
    .from('jobs')
    .update({
      status: 'Submitted',
      job_state: 'idle',
      deliverable_hash: '0x' + 'ff'.repeat(32),
    })
    .eq('job_id', JOB);
  show('hasil', await confirmStructural(JOB));
  const bad = await getJob(JOB);
  show('job_state (harus "error")', bad.job_state);
  show('last_error', bad.last_error);

  line();
  console.log('  4. BUKTI PERBAIKAN BUG URUTAN LOCK');
  console.log('     Job sedang running_verify, lalu indexer lewat mengecek.');
  console.log('     Versi lama memanggil releaseLock TANPA memegang lock,');
  console.log('     sehingga MENIMPA state ini jadi "error" dan menghentikan');
  console.log('     verifikasi yang sedang berjalan.');
  await db()
    .from('jobs')
    .update({
      deliverable_content: null,
      deliverable_hash: null,
      job_state: 'running_verify',
    })
    .eq('job_id', JOB);
  show('hasil', await confirmStructural(JOB));
  const untouched = await getJob(JOB);
  show('job_state (HARUS tetap running_verify)', untouched.job_state);

  line();
  const lulus = untouched.job_state === 'running_verify';
  console.log(lulus ? '  SEMUA BENAR' : '  ADA YANG SALAH -- job_state tertimpa!');
  console.log('\n  Pulihkan data: POST http://localhost:3000/api/dev/seed\n');
  process.exit(lulus ? 0 : 1);
}

main();
