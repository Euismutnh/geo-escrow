import type { Metadata } from 'next';
import { CreateJobView } from '@/components/create/CreateJobView';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = { title: 'Buat kontrak' };

/*
 * Form + transaksi createJob hidup di klien (butuh wallet). Urutan
 * langkahnya dikunci di lib/create-job.ts; halaman ini tetap statis.
 */
export default function CreatePage() {
  return (
    <>
      <PageHeader title="Buat kontrak GEO" sub="Tentukan target, kunci dana di kontrak, dan biarkan Oracle mengukur hasilnya." />
      <CreateJobView />
    </>
  );
}
