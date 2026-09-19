import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getJob } from '@/lib/jobs-repo';
import { contentHash } from '@/lib/hash';
import { checkStructural } from '@/lib/structural';
import { parseJobId } from '@/lib/validate';
import { LIMITS, requireText } from '@/lib/validate-input';
import { rateLimit } from '@/lib/rate-limit';
import { ok, fail, handler, ApiError } from '@/lib/http';

/**
 * POST /api/jobs/:id/deliverable
 *
 * URUTANNYA SENGAJA TERBALIK dari rancangan lama: konten dikirim ke sini
 * DULU, baru freelancer menandatangani submitDeliverable(jobId, hash).
 *
 * Rancangan lama (tx dulu, konten belakangan) punya lubang fatal: kalau
 * tab ditutup di antara keduanya, job nyangkut permanen di status
 * 'Submitted' tanpa konten di database -- Oracle tidak punya apa pun
 * untuk diverifikasi, dan dananya terkunci selamanya.
 *
 * Dengan urutan ini, structural check juga berjalan SEBELUM freelancer
 * membayar gas. Kalau kontennya ditolak, ia belum kehilangan apa pun.
 */
export const POST = handler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const jobId = parseJobId(id);

  // Interlock yang sama dengan POST /api/jobs. Isi deliverable menentukan
  // hasil verifikasi -- dan hasil verifikasi menentukan ke mana uangnya
  // mengalir. Tanpa verifikasi on-chain, endpoint ini menerima tulisan
  // siapa pun sebagai dasar keputusan itu.
  if (env.isProduction && !env.chainEnabled) {
    return fail(
      'WRONG_STATUS',
      'CHAIN_ENABLED harus true di produksi — tanpa itu isi deliverable tidak terverifikasi'
    );
  }

  if (!rateLimit(`deliverable:${jobId}`, 2_000)) {
    return fail('RATE_LIMITED', 'Tunggu sebentar sebelum mengirim ulang');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail('VALIDATION', 'Body harus JSON yang valid');
  }

  // Batas panjang bukan kerapian: isi ini dikirim ke AI sebagai konteks
  // di fase verifikasi, jadi panjangnya menentukan biaya panggilan AI.
  const text = requireText(
    (body as Record<string, unknown>)?.content,
    'content',
    LIMITS.deliverable
  );

  const job = await getJob(jobId);

  // Hanya saat freelancer memang sedang mengerjakan (Accepted), atau
  // sudah menandatangani tx tapi kontennya belum sampai (Submitted).
  if (job.status !== 'Accepted' && job.status !== 'Submitted') {
    return fail('WRONG_STATUS', `Tidak bisa submit deliverable saat status ${job.status}`);
  }

  // ---------- structural check ----------
  const structural = checkStructural(text, job.brand);
  if (!structural.pass) {
    return fail('STRUCTURAL_FAILED', structural.message!);
  }

  const hash = contentHash(text);

  // Begitu transaksi on-chain terkirim, deliverable_hash terisi dan isi
  // kontennya BEKU: apa pun yang dikirim setelah itu harus menghasilkan
  // hash yang sama persis. Inilah yang menutup celah "orang lain menimpa
  // konten setelah freelancer menandatanganinya".
  if (job.deliverable_hash && job.deliverable_hash.toLowerCase() !== hash.toLowerCase()) {
    return fail(
      'HASH_MISMATCH',
      'Konten tidak cocok dengan hash yang sudah dikunci on-chain'
    );
  }

  const { error } = await db()
    .from('jobs')
    .update({ deliverable_content: text, deliverable_hash: hash })
    .eq('job_id', jobId);

  if (error) throw new ApiError('INTERNAL', error.message);

  // hash dikembalikan supaya FE memakainya persis di
  // submitDeliverable(jobId, deliverableHash).
  return ok({ deliverableHash: hash, structuralPass: true, length: text.length });
});
