import type { NextRequest } from 'next/server';
import { getActivity } from '@/lib/jobs-repo';
import { parseIntParam, parseJobId } from '@/lib/validate';
import { ok, handler } from '@/lib/http';

/** GET /api/activity?jobId=1&limit=150 */
export const GET = handler(async (req: NextRequest) => {
  const p = req.nextUrl.searchParams;
  const rawJobId = p.get('jobId');

  const activity = await getActivity(
    rawJobId ? parseJobId(rawJobId) : undefined,
    parseIntParam(p.get('limit'), { def: 150, min: 1, max: 300 })
  );

  return ok({ activity });
});
