import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { getJob } from '@/lib/jobs-repo';
import { contentHash } from '@/lib/hash';
import { checkStructural } from '@/lib/structural';
import { parseJobId } from '@/lib/validate';
import { LIMITS, requireText } from '@/lib/validate-input';
import { rateLimit } from '@/lib/rate-limit';
import { readJobFromChain } from '@/lib/chain-server';
import { contentAllowed, lockedDeliverableHash } from '@/lib/deliverable-lock';
import { ok, fail, handler, internalError } from '@/lib/http';

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

  // Konten BEKU begitu freelancer menandatangani submitDeliverable(hash):
  // setelah itu hanya konten dengan hash PERSIS itu yang diterima — ini
  // yang menutup celah "orang lain menimpa konten setelah ditandatangani".
  //
  // Jangkarnya hash ON-CHAIN, dibaca langsung dari kontrak (bukan kolom
  // DB yang baru terisi setelah sync). Sebelum tanda tangan belum ada yang
  // terkunci, jadi freelancer bebas merevisi drafnya. Lihat
  // lib/deliverable-lock.ts untuk alasan lengkapnya.
  const onChain = env.chainEnabled ? await readJobFromChain(BigInt(jobId)) : null;
  const locked = lockedDeliverableHash({
    chainEnabled: env.chainEnabled,
    onChainHash: onChain?.deliverableHash,
    dbHash: job.deliverable_hash,
  });
  if (!contentAllowed(locked, hash)) {
    return fail(
      'HASH_MISMATCH',
      'Konten tidak cocok dengan hash yang sudah dikunci on-chain'
    );
  }

  // deliverable_hash di DB hanya CERMIN nilai on-chain (§2.1: nilai chain
  // ditulis dari chain). Saat chain mati tidak ada cermin — perilaku lama.
  const { error } = await db()
    .from('jobs')
    .update(
      env.chainEnabled
        ? { deliverable_content: text, deliverable_hash: locked }
        : { deliverable_content: text, deliverable_hash: hash }
    )
    .eq('job_id', jobId);

  if (error) throw internalError('menyimpan deliverable', error);

  // hash dikembalikan supaya FE memakainya persis di
  // submitDeliverable(jobId, deliverableHash).
  return ok({ deliverableHash: hash, structuralPass: true, length: text.length });
});
