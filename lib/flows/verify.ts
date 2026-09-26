import { db } from '../db';
import { env } from '../env';
import { getJob, acquireLock, releaseLock } from '../jobs-repo';
import { runPhase } from '../oracle/runner';
import { subsetSize } from '../vrf';
import { contentHash } from '../hash';
import { decide } from '../scoring';
import { recomputeSubset, verdictHash, type Verdict } from '../verdict';
import { getVerificationSeed, readJobFromChain, readStructuralConfirm, settleOnChain } from '../chain-server';
import { syncSetelahTx } from '../indexer';
import { ApiError, internalError, publicErrorMessage } from '../http';
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
  /**
   * true = tidak ada transaksi BARU yang dikirim karena kontrak sudah
   * berada di status akhir. Dana sudah berpindah di percobaan sebelumnya;
   * ini yang mencegah pembayaran ganda. `txHash` saat itu berisi sentinel
   * '0xsudah', bukan hash sungguhan.
   */
  alreadySettled: boolean;
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
  //
  // Verdict ada + job TIDAK idle = settlement belum tuntas: 'error' (gagal
  // tercatat), atau `running_verify` yang macet dan akan diambil alih
  // acquireLock(). assertVerifiable() sudah menolak kasus verdict + idle.
  const isResume = Boolean(preview.verification_decision);

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

      const { hash: txHash, alreadyDone } = await settleOnChain(
        BigInt(jobId),
        verdict.decision,
        vHash
      );

      await releaseLock(jobId, 'idle');
      await syncSetelahTx(jobId, 'verify');
      return {
        score: verdict.score,
        of: verdict.of,
        decision: verdict.decision,
        verdictHash: vHash,
        subset: verdict.subset,
        txHash,
        settledOnChain: env.chainEnabled,
        alreadySettled: alreadyDone,
        resumedSettlement: true,
      };
    }

    // ---- 0. Status KONTRAK, bukan cermin DB ----
    // DB bisa tertinggal: job yang sudah dieskalasi ke arbiter masih
    // tercatat Verifying sampai ada sync. Diperiksa SEBELUM bertanya ke AI
    // supaya kredit tidak terbakar untuk job yang tidak akan di-settle —
    // settleOnChain() memeriksanya lagi tepat sebelum mengirim.
    const content = job.deliverable_content!;
    let confirm: { tx: string; blockHash: string; deliverableHash: string } | null = null;
    if (env.chainEnabled) {
      const onChain = await readJobFromChain(BigInt(jobId));
      if (!onChain || Number(onChain.status) !== 3) {
        throw new ApiError(
          'WRONG_STATUS',
          'Status di blockchain sudah bukan Verifying — tampilan sedang diperbarui dari blockchain'
        );
      }
      // Yang diukur HARUS konten yang ditandatangani — verdict v2 mencatat
      // hash ini, jadi mengukur konten lain berarti verdict yang berbohong.
      if (contentHash(content).toLowerCase() !== onChain.deliverableHash.toLowerCase()) {
        throw new ApiError('WRONG_STATUS', 'Isi deliverable di server tidak cocok dengan hash on-chain — verifikasi dihentikan');
      }
      // Blok konfirmasi: bahan seed efektif GEOv2 (S-04). Petunjuk tx dari
      // activity, divalidasi di readStructuralConfirm.
      const { data: act } = await db()
        .from('activity')
        .select('tx_hash')
        .eq('job_id', jobId)
        .eq('type', 'structural_release')
        .order('block_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      const c = await readStructuralConfirm(BigInt(jobId), act?.tx_hash ?? null);
      confirm = { tx: c.tx, blockHash: c.blockHash, deliverableHash: onChain.deliverableHash.toLowerCase() };
    }

    // ---- 1. Seed VRF dari on-chain ----
    // Seed kontrak tetap dicatat apa adanya; subset diundi dari seed
    // EFEKTIF (GEOv2) kalau chain menyala — seed kontrak di BSC praktis
    // konstan (S-04). Mode pengembangan tidak punya blok: tetap GEOv1.
    const seed = await getVerificationSeed(BigInt(jobId));

    // ---- 2. Subset ----
    const n = job.queries.length;
    const k = subsetSize(n);
    const base = { jobId: job.job_id, brand: job.brand, seed, n, of: k, target: job.target_count, multiEngine: job.multi_engine };
    const draft: Verdict = confirm
      ? { ...base, v: 'GEOv2', confirmTx: confirm.tx, confirmBlockHash: confirm.blockHash, deliverableHash: confirm.deliverableHash, subset: [], hits: [], score: 0, decision: 'dispute' }
      : { ...base, v: 'GEOv1', subset: [], hits: [], score: 0, decision: 'dispute' };
    const subset = recomputeSubset(draft);

    // ---- 3. Tanya AI, dengan deliverable sebagai konteks ----
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
    const verdict: Verdict = { ...draft, subset, hits, score, decision };
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

    if (error) throw internalError('menyimpan hasil verifikasi', error);

    // ---- 7. Baru kirim on-chain ----
    // Kontrak yang mengubah status dan memindahkan dana. Backend TIDAK
    // menulis kolom `status` — itu wewenang indexer (§2.1).
    const { hash: txHash, alreadyDone } = await settleOnChain(BigInt(jobId), decision, vHash);

    await releaseLock(jobId, 'idle');
    await syncSetelahTx(jobId, 'verify');

    return {
      score,
      of: k,
      decision,
      verdictHash: vHash,
      subset,
      txHash,
      settledOnChain: env.chainEnabled,
      alreadySettled: alreadyDone,
      resumedSettlement: false,
    };
  } catch (e) {
    await releaseLock(jobId, 'error', publicErrorMessage(e, 'Kesalahan sistem — detail tercatat di log server'));
    // Settle mungkin tetap masuk blok (receipt hilang), atau status kontrak
    // memang sudah berubah (WRONG_STATUS di atas) — DB harus mengikutinya.
    await syncSetelahTx(jobId, 'verify');
    throw e;
  }
}

/** Pemeriksaan SEBELUM lock, saat job_state masih apa adanya. */
function assertVerifiable(job: Job): void {
  assertBasics(job);

  // Verdict sudah ada DAN job idle = benar-benar selesai. Selain idle
  // ('error', atau running_verify macet), settlement-nya belum tuntas dan
  // boleh diulang lewat jalur lanjutan. running_verify yang MASIH hidup
  // ditolak acquireLock() dengan BUSY.
  //
  // Karena itu TIDAK ADA jalur lain yang boleh menyetel job ber-verdict ke
  // 'idle' selain settlement yang sukses — lihat penjaga di runBaseline().
  if (job.verification_decision && job.job_state === 'idle') {
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
