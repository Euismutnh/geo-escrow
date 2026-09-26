import { db } from '../db';
import { getJob, acquireLock, releaseLock } from '../jobs-repo';
import { syncSetelahTx } from '../indexer';
import { publicErrorMessage } from '../http';
import { confirmStructuralOnChain, readJobFromChain, rejectStructuralOnChain } from '../chain-server';
import {
  contentAllowed, HASH_MISMATCH_ERROR, lockedDeliverableHash, signedContentGraceExpired, SIGNED_CONTENT_MISSING_REASON,
} from '../deliverable-lock';
import { env } from '../env';
import { contentHash } from '../hash';
import { checkStructural } from '../structural';

export type ConfirmResult =
  | {
      ok: true;
      txHash: string;
      /**
       * true = kontrak SUDAH melewati structural, jadi tidak ada transaksi
       * baru yang dikirim. Indexer memanggil alur ini berkali-kali untuk
       * job yang sama; tanpa penanda ini, setiap panggilan akan terlihat
       * seperti pencairan 20% yang baru.
       */
      alreadyDone: boolean;
    }
  | {
      ok: false;
      skipped: string;
      /**
       * Terisi hanya kalau structural GAGAL dan kontrak sudah diberi tahu
       * lewat `rejectStructural` — job kembali ke `Accepted` dan freelancer
       * boleh submit ulang. Alasan dilewati yang lain (status belum siap,
       * konten belum ada, job sedang dikerjakan proses lain) tidak
       * menyentuh kontrak sama sekali.
       */
      rejectedOnChain?: string;
    };

/**
 * Konfirmasi structural ke smart contract -- inilah yang memicu
 * pencairan 20% dan memindahkan status ke `Verifying`.
 *
 * Dipanggil lewat after() di POST /api/sync/:id (FE menyinkronkan setelah
 * submitDeliverable), dan disapu GET /api/indexer/poll untuk job yang
 * tertinggal di `Submitted`. IDEMPOTEN: aman dipanggil berkali-kali.
 *
 * Setelah setiap transaksi Oracle, status DB disegarkan dari chain
 * (syncSetelahTx) — tidak ada pihak lain yang akan melakukannya.
 *
 * URUTANNYA: lock dulu, BARU periksa. Rancangan awal melakukan
 * sebaliknya -- dan pada cabang "hash tidak cocok" ia memanggil
 * releaseLock() padahal belum pernah memegang lock. Kalau job kebetulan
 * sedang `running_verify`, panggilan itu akan MENIMPA state-nya jadi
 * 'error' dan menghentikan verifikasi yang sedang berjalan.
 */
export async function confirmStructural(jobId: number): Promise<ConfirmResult> {
  // Pemeriksaan murah dulu, supaya tidak mengambil lock untuk job yang
  // jelas-jelas belum siap (indexer memanggil ini cukup sering).
  const preview = await getJob(jobId);
  if (preview.status !== 'Submitted') return { ok: false, skipped: `status ${preview.status}` };
  // Tanpa konten: tunggu — kecuali masa tunggu konten bertanda tangan sudah
  // habis (S-22), maka lanjut mengambil lock untuk mengembalikannya.
  const submittedMs = preview.deliverable_submitted_at ? Date.parse(preview.deliverable_submitted_at) : NaN;
  if (!preview.deliverable_content && !(env.chainEnabled && Number.isFinite(submittedMs) && signedContentGraceExpired(submittedMs / 1000, Date.now()))) {
    return { ok: false, skipped: 'menunggu konten' };
  }

  const locked = await acquireLock(jobId, ['idle', 'error'], 'running_structural');
  if (!locked) return { ok: false, skipped: 'sedang dikerjakan proses lain' };

  try {
    // Baca ULANG di dalam lock. Yang di atas cuma saringan; kondisi bisa
    // berubah di antara pemeriksaan dan pengambilan lock.
    const job = await getJob(jobId);

    if (job.status !== 'Submitted') {
      await releaseLock(jobId, 'idle');
      return { ok: false, skipped: `status berubah jadi ${job.status}` };
    }

    const content = job.deliverable_content;

    // Konten bertanda tangan tidak pernah sampai (atau tidak cocok) dan
    // masa tunggunya habis → kembalikan ke Accepted supaya freelancer bisa
    // mengirim ulang, alih-alih tertahan sampai eskalasi 7 hari (S-22).
    // Patokan waktunya dari KONTRAK (submittedAt), bukan kolom DB.
    const kembalikan = async (sebab: string): Promise<ConfirmResult> => {
      const { hash: txHash } = await rejectStructuralOnChain(BigInt(jobId), SIGNED_CONTENT_MISSING_REASON);
      await releaseLock(jobId, 'idle', SIGNED_CONTENT_MISSING_REASON);
      await syncSetelahTx(jobId, 'structural');
      return { ok: false, skipped: sebab, rejectedOnChain: txHash };
    };

    if (!content) {
      const oc = env.chainEnabled ? await readJobFromChain(BigInt(jobId)) : null;
      if (oc && Number(oc.status) === 2 && signedContentGraceExpired(oc.submittedAt, Date.now())) {
        return await kembalikan('konten bertanda tangan tidak pernah diterima');
      }
      await releaseLock(jobId, 'idle');
      return { ok: false, skipped: 'menunggu konten' };
    }

    // Gerbang: isi di database harus BENAR-BENAR yang di-commit on-chain.
    // Tanpa ini, freelancer bisa menandatangani hash konten A lalu
    // menyodorkan konten B untuk diverifikasi Oracle.
    //
    // Hash dibaca dari KONTRAK, bukan kolom DB: dulu gerbang ini
    // `if (job.deliverable_hash && …)` — dilewati diam-diam kalau kolom itu
    // kosong. Kalau hash on-chain belum terbaca, jangan menebak: lewati dan
    // biarkan sync berikutnya mencoba lagi.
    const computed = contentHash(content);
    const onChain = await readJobFromChain(BigInt(jobId));
    const signed = lockedDeliverableHash({
      chainEnabled: env.chainEnabled,
      onChainHash: onChain?.deliverableHash,
      dbHash: job.deliverable_hash,
    });
    if (signed === null) {
      await releaseLock(jobId, 'idle');
      return { ok: false, skipped: 'hash deliverable on-chain belum terbaca' };
    }
    if (!contentAllowed(signed, computed)) {
      if (env.chainEnabled && onChain && Number(onChain.status) === 2 && signedContentGraceExpired(onChain.submittedAt, Date.now())) {
        return await kembalikan('konten tidak cocok dengan hash, masa tunggu habis');
      }
      // 'error' bukan jalan buntu: acquireLock menerima ['idle','error'],
      // jadi sync berikutnya mencoba lagi begitu konten yang benar dikirim.
      await releaseLock(jobId, 'error', HASH_MISMATCH_ERROR);
      return { ok: false, skipped: 'hash tidak cocok' };
    }

    // Periksa ulang structural juga. Route sudah menolak konten buruk,
    // tapi baris ini menutup kemungkinan konten masuk lewat jalur lain
    // (indexer, migrasi data, perbaikan manual di database).
    const structural = checkStructural(content, job.brand);
    if (!structural.pass) {
      // `message` opsional di StructuralResult. Cadangannya bukan basa-basi:
      // string ini dikirim ke kontrak dan tersimpan permanen di event —
      // string kosong di sana tidak bisa diperbaiki lagi.
      const alasan = structural.message ?? `Structural gagal: ${structural.reason ?? 'tidak lolos'}`;

      // Kontrak WAJIB diberi tahu. Tanpa ini, job tetap `Submitted`
      // selamanya di on-chain: `submitDeliverable` menolak status itu,
      // jadi freelancer tidak bisa submit ulang, dan dana terkunci
      // sampai ada yang memanggil escalateStuckJob() setelah 7 hari.
      //
      // `rejectStructural` mengembalikannya ke `Accepted` — bond tetap
      // di tangan freelancer, dan ia boleh mencoba lagi.
      const { hash: txHash } = await rejectStructuralOnChain(
        BigInt(jobId),
        // Pesannya masuk ke event StructuralRejected dan terbaca publik
        // selamanya. `alasan` aman: ia hanya menyebut aturan
        // yang dilanggar (panjang minimum, nama brand), tidak pernah
        // mengutip isi deliverable.
        alasan
      );

      // 'idle', bukan 'error': penolakan structural adalah hasil yang SAH,
      // bukan kegagalan sistem. 'error' akan membuat reclaimStaleLocks()
      // dan tombol coba-lagi di UI memperlakukannya sebagai sesuatu yang
      // perlu diulang — padahal yang perlu terjadi adalah freelancer
      // mengirim konten baru. `last_error` tetap diisi supaya alasannya
      // terbaca di UI.
      await releaseLock(jobId, 'idle', alasan);
      await syncSetelahTx(jobId, 'structural');
      return {
        ok: false,
        skipped: `structural gagal: ${structural.reason}`,
        rejectedOnChain: txHash,
      };
    }

    // Kontrak yang menghitung dan mencairkan 20%. Backend TIDAK pernah
    // menghitung angkanya sendiri -- nilai sebenarnya masuk ke database
    // lewat event StructuralConfirmed, dan indexer yang menuliskannya.
    const { hash: txHash, alreadyDone } = await confirmStructuralOnChain(BigInt(jobId));

    await releaseLock(jobId, 'idle');
    // `alreadyDone` juga: artinya chain SUDAH di depan database.
    await syncSetelahTx(jobId, 'structural');
    return { ok: true, txHash, alreadyDone };
  } catch (e) {
    await releaseLock(jobId, 'error', publicErrorMessage(e, 'Kesalahan sistem — detail tercatat di log server'));
    // Tx bisa saja masuk blok walau receipt-nya tidak terbaca.
    await syncSetelahTx(jobId, 'structural');
    throw e;
  }
}

/**
 * Jaring pengaman untuk job yang tertinggal di `Submitted`.
 *
 * confirmStructural() normalnya dipicu after() di POST /api/sync/:id —
 * yang hanya terjadi kalau tab freelancer masih terbuka setelah receipt.
 * Tab ditutup lebih cepat, atau after() dipotong platform, berarti tidak
 * ada lagi yang memicunya: job diam di `Submitted` sampai eskalasi 7 hari.
 * Dipanggil GET /api/indexer/poll.
 *
 * Dibatasi jumlah DAN waktu: tiap konfirmasi bisa menunggu receipt sampai
 * RECEIPT_TIMEOUT_MS, dan poll punya maxDuration 60 detik. Job berikutnya
 * hanya dimulai kalau masih ada sisa waktu yang cukup.
 */
export async function sweepSubmitted(opts: { max: number; deadlineMs: number }): Promise<number> {
  const { data, error } = await db()
    .from('jobs')
    .select('job_id')
    .eq('status', 'Submitted')
    .in('job_state', ['idle', 'error'])
    // Termasuk yang BELUM punya konten: confirmStructural mengembalikannya
    // ke Accepted kalau masa tunggu konten bertanda tangan habis (S-22).
    .order('job_state_at', { ascending: true })
    .limit(opts.max);

  if (error) {
    console.error('[sweep] gagal membaca job Submitted:', error);
    return 0;
  }

  let dicoba = 0;
  for (const { job_id } of data ?? []) {
    if (Date.now() > opts.deadlineMs) break;
    dicoba++;
    try {
      const r = await confirmStructural(job_id);
      if (!r.ok) console.log(`[sweep] job ${job_id} structural dilewati: ${r.skipped}`);
    } catch (e) {
      // confirmStructural sudah menyetel job_state='error' + last_error.
      console.error(`[sweep] job ${job_id} structural gagal:`, e);
    }
  }
  return dicoba;
}
