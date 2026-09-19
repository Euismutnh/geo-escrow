import type { NextRequest } from 'next/server';
import { getRuns } from '@/lib/jobs-repo';
import { parseJobId } from '@/lib/validate';
import { ok, fail, handler } from '@/lib/http';

const PHASES = ['baseline', 'verification'] as const;
type Phase = (typeof PHASES)[number];

/** GET /api/jobs/:id/oracle-log?phase=baseline|verification */
export const GET = handler(async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params;
  const jobId = parseJobId(id);

  const raw = req.nextUrl.searchParams.get('phase');
  if (raw && !PHASES.includes(raw as Phase)) {
    return fail('VALIDATION', `phase harus salah satu: ${PHASES.join(', ')}`);
  }

  return ok({ runs: await getRuns(jobId, (raw as Phase) ?? undefined) });
});
