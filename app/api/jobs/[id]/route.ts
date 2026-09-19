import type { NextRequest } from 'next/server';
import { getJob, getRuns, getActivity } from '@/lib/jobs-repo';
import { parseJobId } from '@/lib/validate';
import { ok, handler } from '@/lib/http';

/**
 * GET /api/jobs/:id?include=runs,activity
 *
 * `include` menghemat satu request: halaman detail butuh oracle_runs
 * untuk radar sitasi, dan activity untuk ledger.
 */
export const GET = handler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  // Next.js 16: params adalah Promise, WAJIB di-await.
  const { id } = await params;
  const jobId = parseJobId(id);

  const include = (req.nextUrl.searchParams.get('include') ?? '')
    .split(',')
    .map((s) => s.trim());

  const job = await getJob(jobId);

  const [runs, activity] = await Promise.all([
    include.includes('runs') ? getRuns(jobId) : Promise.resolve(undefined),
    include.includes('activity') ? getActivity(jobId) : Promise.resolve(undefined),
  ]);

  return ok({ job, runs, activity });
});
