import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/PageHeader';
import { Upcoming } from '@/components/ui/Upcoming';

export const metadata: Metadata = { title: 'Log Oracle' };

export default function OracleLogPage() {
  return (
    <>
      <PageHeader title="Log Oracle" sub="Setiap pertanyaan yang diajukan Oracle ke AI, beserta jawaban lengkapnya." />
      <Upcoming icon="radar" phase={3} what="Setiap panggilan AI dari semua kontrak: pertanyaan, jawaban, dan apakah brand disebut." />
    </>
  );
}
