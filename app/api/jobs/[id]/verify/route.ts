import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { runVerification } from '@/lib/flows/verify';
import { parseJobId } from '@/lib/validate';
import { rateLimit } from '@/lib/rate-limit';
import { ok, fail, handler, ApiError } from '@/lib/http';

// Verifikasi memanggil AI untuk subset pertanyaan, lalu mengirim transaksi.
export const maxDuration = 60;

/**
 * POST /api/jobs/:id/verify
 *
 * Endpoint paling mahal di sistem: memanggil AI DAN mengirim transaksi
 * yang memindahkan dana. Penjaganya berlapis empat:
 *
 *   1. interlock produksi  -- tanpa chain, settlement tidak berarti apa-apa
 *   2. rate limit 30 detik -- meredam klik berulang
 *   3. status guard        -- hanya saat status Verifying
 *   4. lock atomik di DB   -- satu-satunya yang berlaku lintas instance
 *
 * Tiga yang pertama cuma peredam. Yang benar-benar mencegah dua proses
 * berjalan bersamaan adalah nomor 4.
 */
export const POST = handler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const jobId = parseJobId(id);

  if (env.isProduction && !env.chainEnabled) {
    return fail(
      'WRONG_STATUS',
      'CHAIN_ENABLED harus true di produksi — tanpa itu settlement tidak terjadi'
    );
  }

  if (!rateLimit(`verify:${jobId}`, 30_000)) {
    return fail('RATE_LIMITED', 'Tunggu sebentar sebelum memverifikasi lagi');
  }

  try {
    return ok(await runVerification(jobId));
  } catch (e) {
    if (e instanceof ApiError) return fail(e.code, e.message);
    return fail('ORACLE_FAILED', e instanceof Error ? e.message : 'Verifikasi gagal');
  }
});
