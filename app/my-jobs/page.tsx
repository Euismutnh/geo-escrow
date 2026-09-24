import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui/PageHeader';
import { Upcoming } from '@/components/ui/Upcoming';

export const metadata: Metadata = { title: 'Kontrak saya' };

export default function MyJobsPage() {
  return (
    <>
      <PageHeader title="Kontrak saya" sub="Kontrak yang Anda danai atau kerjakan dengan wallet ini." />
      <Upcoming icon="folder" phase={3} what="Kontrak yang melibatkan wallet aktif, sebagai client maupun freelancer." />
    </>
  );
}
