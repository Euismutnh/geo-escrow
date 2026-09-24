import { after } from 'next/server';
import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { syncJob } from '@/lib/indexer';
import { confirmStructural } from '@/lib/flows/structural';
import { parseJobId } from '@/lib/validate';
import { rateLimit } from '@/lib/rate-limit';
import { ok, fail, handler } from '@/lib/http';

// syncJob menembak RPC sekali + getJob sekali. Cepat, tapi jangan tanpa batas.
export const maxDuration = 30;

/**
 * POST /api/sync/:id — tarik ulang satu job dari blockchain.
 *
 * Dipanggil FE tepat setelah sebuah transaksi dapat receipt. Inilah yang
 * membuat UI terasa hidup: tanpa ini, perubahan baru muncul saat cron
 * berikutnya jalan.
 *
 * Sengaja TERBUKA (tanpa auth). Endpoint ini tidak menerima data apa pun —
 * ia hanya menyuruh backend membaca ulang dari kontrak, dan kontraknya
 * yang jadi sumber kebenaran. Yang paling buruk bisa dilakukan penyerang
 * adalah memaksa kita membaca RPC; itu yang ditahan rate limit di bawah.
 */
export const POST = handler(
  async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    // Next.js 16: params adalah Promise.
    const { id } = await ctx.params;
    const jobId = parseJobId(id);

    if (!env.chainEnabled) {
      return fail(
        'WRONG_STATUS',
        'CHAIN_ENABLED=false — tidak ada blockchain untuk disinkronkan'
      );
    }

    // Dua lapis, sama pola dengan POST /api/jobs.
    //
    // Per-job dibuat longgar (2 detik): FE memanggil ini setelah TIAP
    // receipt, dan satu alur normal bisa menghasilkan beberapa panggilan
    // beruntun yang semuanya sah.
    if (!rateLimit(`sync:${jobId}`, 2_000)) {
      return fail('RATE_LIMITED', 'Job ini baru saja disinkronkan, tunggu sebentar');
    }
    // Lapis global menahan penyapuan banyak jobId sekaligus — yang
    // per-job tidak bisa menangkapnya karena tiap job punya jatahnya sendiri.
    if (!rateLimit('sync:global', 300)) {
      return fail('RATE_LIMITED', 'Server sedang sibuk, coba lagi sebentar');
    }

    const hasil = await syncJob(jobId);

    if (!hasil.adaDiChain) {
      return fail(
        'NOT_FOUND',
        `Job ${jobId} belum ada di blockchain, atau tidak punya metadata di database`
      );
    }

    // Deliverable yang baru masuk butuh konfirmasi structural ke kontrak —
    // itu yang mencairkan 20% dan memindahkan job ke Verifying.
    //
    // Dijalankan SETELAH respons terkirim: ia mengirim transaksi dan
    // menunggu receipt, dan user tidak perlu menatap spinner untuk itu.
    // confirmStructural sudah idempoten dan mengunci sendiri, jadi aman
    // walau cron kebetulan mengerjakannya bersamaan.
    after(async () => {
      try {
        const r = await confirmStructural(jobId);
        if (!r.ok) console.log(`[sync] job ${jobId} structural dilewati: ${r.skipped}`);
      } catch (e) {
        // confirmStructural sudah menyetel job_state='error' + last_error,
        // jadi UI tetap bisa menampilkan alasannya.
        console.error(`[sync] job ${jobId} structural gagal:`, e);
      }
    });

    return ok(hasil);
  }
);
