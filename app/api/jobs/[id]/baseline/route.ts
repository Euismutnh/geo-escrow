import type { NextRequest } from 'next/server';
import { runBaseline } from '@/lib/oracle/runner';
import { getJob } from '@/lib/jobs-repo';
import { parseJobId, verifyCronSecret } from '@/lib/validate';
import { rateLimit } from '@/lib/rate-limit';
import { ok, fail, handler, ApiError } from '@/lib/http';

// Baseline memanggil AI beberapa kali. Dengan CONCURRENCY=3 di runner,
// kasus terberat (6 pertanyaan x 2 engine) sekitar 20 detik -- tapi tetap
// beri ruang penuh kalau provider sedang lambat.
export const maxDuration = 60;

/**
 * POST /api/jobs/:id/baseline
 *
 * ENDPOINT INI MEMBAKAR KREDIT AI, jadi aksesnya dibatasi ketat:
 *
 *   - Dengan header `Authorization: Bearer <CRON_SECRET>` -> selalu boleh.
 *     Ini jalur internal (cron penyapu, dan pengujian manual).
 *
 *   - Tanpa header -> HANYA boleh kalau job_state = 'error', yaitu
 *     tombol "coba lagi" untuk baseline yang memang gagal.
 *
 * Baseline PERTAMA tidak pernah lewat sini: Fase 6 memanggil runBaseline()
 * langsung lewat after() setelah job dibuat. Jadi tidak ada alasan sah
 * bagi publik untuk memicu pengukuran baru dari nol -- dan rancangan awal
 * yang mengizinkan itu (selama baseline_score masih null) berarti siapa
 * pun bisa menyuruh server kita menghabiskan kredit AI.
 */
export const POST = handler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const jobId = parseJobId(id);

  const isInternal = verifyCronSecret(req.headers.get('authorization'));

  if (!isInternal) {
    if (!rateLimit(`baseline:${jobId}`, 10_000)) {
      return fail('RATE_LIMITED', 'Tunggu sebentar sebelum mencoba lagi');
    }

    const job = await getJob(jobId);
    if (job.job_state !== 'error') {
      return fail(
        'WRONG_STATUS',
        job.baseline_score === null
          ? 'Baseline dijalankan otomatis saat job dibuat, tidak bisa dipicu manual'
          : 'Baseline sudah pernah diukur'
      );
    }
  }

  try {
    return ok(await runBaseline(jobId));
  } catch (e) {
    if (e instanceof ApiError) return fail(e.code, e.message);
    return fail('ORACLE_FAILED', e instanceof Error ? e.message : 'Oracle gagal');
  }
});
