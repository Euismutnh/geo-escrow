import type { Metadata } from 'next';
import { type LogPhase, OracleLogView } from '@/components/oracle/OracleLogView';
import { PageHeader } from '@/components/ui/PageHeader';
import { firstParam } from '@/lib/route-params';

export const metadata: Metadata = { title: 'Log Oracle' };

export default async function OracleLogPage(props: PageProps<'/oracle-log'>) {
  const raw = firstParam((await props.searchParams).phase);
  const phase: LogPhase = raw === 'baseline' || raw === 'verification' ? raw : 'all';
  return (
    <>
      <PageHeader title="Log Oracle" sub="Setiap pertanyaan yang diajukan Oracle ke AI, beserta jawaban lengkapnya." />
      <OracleLogView phase={phase} />
    </>
  );
}
