import { db } from '../db';
import { env } from '../env';
import { getJob, acquireLock, releaseLock } from '../jobs-repo';
import { runPhase } from '../oracle/runner';
import { deriveSubset, subsetSize } from '../vrf';
import { decide } from '../scoring';
import { verdictHash, type Verdict } from '../verdict';
import { getVerificationSeed, settleOnChain } from '../chain-server';
import { ApiError } from '../http';
import type { Job } from '../types';

export interface VerifyResult {
  score: number;
  of: number;
  decision: 'release' | 'refund' | 'dispute';
  verdictHash: string;
  subset: number[];
  txHash: string;
  /** false = settlement tidak benar-benar terjadi (CHAIN_ENABLED=false). */
  settledOnChain: boolean;
  /** true = verdict sudah ada sebelumnya, yang diulang hanya settlement-nya. */
  resumedSettlement: boolean;
}

/**
 * Verifikasi (T1) — inti sistem.
 *
 * Urutannya sengaja: SIMPAN VERDICT DULU, BARU KIRIM ON-CHAIN.
 *
 * Rancangan awal melakukan sebaliknya (settle dulu, simpan belakangan).
 * Kalau penyimpanan gagal setelah transaksi berhasil — database sesaat
 * tidak terjangkau, jaringan putus — hasilnya: dana SUDAH berpindah
 * on-chain, tapi database tidak punya catatan verdict sama sekali.
 * `verification_decision` masih null, sehingga percobaan berikutnya
 * mengulang seluruh verifikasi DAN memanggil settleOnChain lagi.
 * Itu pembayaran ganda.
 *
 * Dengan urutan ini, kegagalan settlement meninggalkan jejak yang jelas:
 * verdict tersimpan + `job_state='error'`. Percobaan berikutnya mengenali
 * kondisi itu dan HANYA mengulang settlement, memakai verdict yang sama
 * persis — hash-nya identik, tidak ada perhitungan ulang.
 */
export async function runVerification(jobId: number): Promise<VerifyResult> {
  // Saringan murah sebelum mengambil lock.
  const preview = await getJob(jobId);
  assertVerifiable(preview);

  // Tentukan jalurnya SEKARANG, selagi job_state masih apa adanya.
  //
  // Ini yang membuat penandanya harus dibaca di sini, bukan nanti:
  // acquireLock() menimpa job_state jadi 'running_verify', sehingga
  // penanda 'error' -- satu-satunya petunjuk bahwa verdict sudah ada tapi
  // settlement-nya gagal -- LENYAP begitu lock diambil. Membacanya setelah
  // itu akan selalu menyimpulkan "sudah diverifikasi" dan settlement yang
  // gagal tidak akan pernah bisa diulang.
  const isResume = Boolean(preview.verification_decision && preview.job_state === 'error');

  const locked = await acquireLock(jobId, ['idle', 'error'], 'running_verify');
  if (!locked) throw new ApiError('BUSY', 'Verifikasi sedang berjalan untuk job ini');

  try {
    // Baca ULANG di dalam lock: status atau konten bisa berubah di antara
    // saringan dan pengambilan lock.
    const job = await getJob(jobId);
    assertStillVerifiable(job, isResume);

    // ---- Jalur lanjutan: verdict sudah ada, settlement-nya yang gagal ----
    if (isResume && job.verification_decision && job.verdict_json) {
      const verdict = job.verdict_json as Verdict;
      const vHash = verdictHash(verdict);

      const { hash: txHash } = await settleOnChain(
        BigInt(jobId),
        verdict.decision,
        vHash
      );

      await releaseLock(jobId, 'idle');
      return {
        score: verdict.score,
        of: verdict.of,
        decision: verdict.decision,
        verdictHash: vHash,
        subset: verdict.subset,
        txHash,
        settledOnChain: env.chainEnabled,
        resumedSettlement: true,
      };
    }

    // ---- 1. Seed VRF dari on-chain ----
    // Inilah yang membuat pemilihan subset bisa diaudit: siapa pun yang
    // tahu seed bisa menghitung ulang subset yang sama persis, sehingga
    // Oracle tidak bisa mengulang undian sampai dapat yang menguntungkan.
    const seed = await getVerificationSeed(BigInt(jobId));

    // ---- 2. Subset ----
    const n = job.queries.length;
    const k = subsetSize(n);
    const subset = deriveSubset(seed, n, k);

    // ---- 3. Tanya AI, dengan deliverable sebagai konteks ----
    const content = job.deliverable_content!;
    const perQuery = await runPhase(job, {
      phase: 'verification',
      indices: subset,
      contextContent: content,
    });

    const hits = subset.map((i) => (perQuery.get(i) ? 1 : 0));
    const score = hits.reduce<number>((a, b) => a + b, 0);

    // ---- 4. Keputusan — aritmetika integer murni ----
    const decision = decide({ score, of: k, target: job.target_count, n });

    // ---- 5. Verdict yang bisa diaudit siapa pun ----
    const verdict: Verdict = {
      v: 'GEOv1',
      jobId: job.job_id,
      brand: job.brand,
      seed,
      subset,
      hits,
      score,
      of: k,
      target: job.target_count,
      n,
      multiEngine: job.multi_engine,
      decision,
    };
    const vHash = verdictHash(verdict);

    // ---- 6. SIMPAN DULU (lihat catatan di atas fungsi) ----
    // Lock masih dipegang, job_state masih 'running_verify'.
    const { error } = await db()
      .from('jobs')
      .update({
        verification_seed: seed,
        verification_subset: subset,
        verification_score: score,
        verification_of: k,
        verification_decision: decision,
        verification_at: new Date().toISOString(),
        verdict_hash: vHash,
        verdict_json: verdict,
      })
      .eq('job_id', jobId);

    if (error) throw new ApiError('INTERNAL', error.message);

    // ---- 7. Baru kirim on-chain ----
    // Kontrak yang mengubah status dan memindahkan dana. Backend TIDAK
    // menulis kolom `status` — itu wewenang indexer (§2.1).
    const { hash: txHash } = await settleOnChain(BigInt(jobId), decision, vHash);

    await releaseLock(jobId, 'idle');

    return {
      score,
      of: k,
      decision,
      verdictHash: vHash,
      subset,
      txHash,
      settledOnChain: env.chainEnabled,
      resumedSettlement: false,
    };
  } catch (e) {
    await releaseLock(jobId, 'error', e instanceof Error ? e.message : String(e));
    throw e;
  }
}

/** Pemeriksaan SEBELUM lock, saat job_state masih apa adanya. */
function assertVerifiable(job: Job): void {
  assertBasics(job);

  // Verdict sudah ada DAN job tidak sedang error = benar-benar selesai.
  // Kalau job_state 'error', berarti settlement-nya yang gagal dan boleh
  // diulang lewat jalur lanjutan.
  if (job.verification_decision && job.job_state !== 'error') {
    throw new ApiError('WRONG_STATUS', 'Job ini sudah diverifikasi');
  }
}

/**
 * Pemeriksaan DI DALAM lock.
 *
 * Tidak bisa memakai assertVerifiable(): job_state sudah berubah jadi
 * 'running_verify' karena lock kita sendiri, sehingga penanda 'error'
 * tidak lagi terbaca. Karena itu jalurnya diputuskan di luar (isResume)
 * dan di sini tinggal memastikan tidak ada yang berubah di antaranya.
 */
function assertStillVerifiable(job: Job, isResume: boolean): void {
  assertBasics(job);

  // Kalau BUKAN jalur lanjutan, verdict harus masih kosong. Kalau sudah
  // terisi, berarti proses lain menyelesaikannya di antara saringan dan
  // pengambilan lock kita -- jangan dihitung ulang lalu di-settle lagi.
  if (!isResume && job.verification_decision) {
    throw new ApiError('WRONG_STATUS', 'Job ini sudah diverifikasi proses lain');
  }
}

function assertBasics(job: Job): void {
  if (job.status !== 'Verifying') {
    throw new ApiError(
      'WRONG_STATUS',
      `Verifikasi hanya bisa saat status Verifying (sekarang ${job.status})`
    );
  }
  if (!job.deliverable_content) {
    throw new ApiError('WRONG_STATUS', 'Belum ada deliverable untuk diverifikasi');
  }
}
