import type { Metadata } from 'next';
import { MyJobsView } from '@/components/jobs/MyJobsView';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = { title: 'Kontrak saya' };

/*
 * Tanpa wallet tidak ada "saya". Isinya dari GET /api/jobs?wallet=<alamat
 * aktif> — client ATAU freelancer — dibaca di klien karena alamatnya hanya
 * diketahui browser. Halaman ini tetap statis; datanya tidak.
 */
export default function MyJobsPage() {
  return (
    <>
      <PageHeader title="Kontrak saya" sub="Kontrak yang Anda danai atau kerjakan dengan wallet ini." />
      <MyJobsView />
    </>
  );
}
