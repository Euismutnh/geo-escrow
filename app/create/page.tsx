import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/PageHeader';
import { Upcoming } from '@/components/ui/Upcoming';

export const metadata: Metadata = { title: 'Buat kontrak' };

export default function CreatePage() {
  return (
    <>
      <PageHeader title="Buat kontrak GEO" sub="Tentukan target, kunci dana di kontrak, dan biarkan Oracle mengukur hasilnya." />
      <Upcoming icon="plus" phase={6} what="Formulir brand, pertanyaan, target, budget, dan batas ambil — lalu tanda tangan createJob." />
    </>
  );
}
