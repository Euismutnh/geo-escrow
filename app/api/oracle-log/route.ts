import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { parseIntParam, parseJobId } from '@/lib/validate';
import { ok, fail, handler, internalError } from '@/lib/http';

const PHASES = ['baseline', 'verification'] as const;
type Phase = (typeof PHASES)[number];

/**
 * GET /api/oracle-log?jobId=&phase=&limit=
 *
 * Versi GLOBAL -- halaman "Log Oracle" di prototipe menampilkan run dari
 * SEMUA job, bukan satu. `jobs(brand)` ikut diambil lewat relasi supaya
 * FE tidak perlu request kedua untuk menampilkan nama brand tiap baris.
 */
export const GET = handler(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;

  const rawPhase = p.get('phase');
  if (rawPhase && !PHASES.includes(rawPhase as Phase)) {
    return fail('VALIDATION', `phase harus salah satu: ${PHASES.join(', ')}`);
  }

  let q = db()
    .from('oracle_runs')
    .select('*, jobs(brand)')
    .order('created_at', { ascending: false })
    .limit(parseIntParam(p.get('limit'), { def: 150, min: 1, max: 300 }));

  const rawJobId = p.get('jobId');
  if (rawJobId) q = q.eq('job_id', parseJobId(rawJobId));
  if (rawPhase) q = q.eq('phase', rawPhase);

  const { data, error } = await q;
  if (error) throw internalError('memuat log Oracle', error);

  return ok({ runs: data ?? [] });
});
