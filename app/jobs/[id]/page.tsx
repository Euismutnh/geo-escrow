import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui/PageHeader';
import { Upcoming } from '@/components/ui/Upcoming';
import { parseJobIdParam } from '@/lib/route-params';

/*
 * Next.js 16: `params` adalah Promise dan WAJIB di-await — akses sinkron
 * sudah dihapus (docs upgrading/version-16.md "Async Request APIs").
 *
 * jobId 0 SAH (job pertama di kontrak). parseJobIdParam mengembalikan
 * null untuk yang tidak valid, bukan 0 — jadi pemeriksaannya `=== null`,
 * tidak pernah `if (!id)` (blueprint §A9).
 */
export async function generateMetadata(props: PageProps<'/jobs/[id]'>): Promise<Metadata> {
  const id = parseJobIdParam((await props.params).id);
  return { title: id === null ? 'Tidak ditemukan' : `Kontrak #${id}` };
}

export default async function JobPage(props: PageProps<'/jobs/[id]'>) {
  const id = parseJobIdParam((await props.params).id);
  if (id === null) notFound();

  return (
    <>
      <PageHeader title={`Kontrak #${id}`} />
      <Upcoming icon="file" phase={4} what="Perjalanan kontrak, query pool, ledger escrow, radar sitasi AI, dan audit verdict." />
    </>
  );
}
