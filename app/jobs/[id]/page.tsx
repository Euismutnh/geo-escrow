import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JobDetailView, type DetailTab } from '@/components/job/JobDetailView';
import { firstParam, parseJobIdParam } from '@/lib/route-params';

/*
 * Next.js 16: `params` & `searchParams` adalah Promise dan WAJIB di-await —
 * akses sinkron sudah dihapus (docs upgrading/version-16.md "Async Request
 * APIs"). searchParams bisa berupa array; firstParam() menanganinya.
 *
 * jobId 0 SAH (job pertama di kontrak). parseJobIdParam mengembalikan
 * null untuk yang tidak valid, bukan 0 — jadi pemeriksaannya `=== null`,
 * tidak pernah `if (!id)` (blueprint §A9).
 *
 * Id yang BENTUKNYA sah tapi tidak ada di database (mis. /jobs/99999)
 * ditangani di klien: datanya dimuat lewat API, dan 404 dari sana
 * ditampilkan sebagai "Kontrak tidak ditemukan".
 */
export async function generateMetadata(props: PageProps<'/jobs/[id]'>): Promise<Metadata> {
  const id = parseJobIdParam((await props.params).id);
  return { title: id === null ? 'Tidak ditemukan' : `Kontrak #${id}` };
}

export default async function JobPage(props: PageProps<'/jobs/[id]'>) {
  const id = parseJobIdParam((await props.params).id);
  if (id === null) notFound();

  const tab: DetailTab = firstParam((await props.searchParams).tab) === 'log' ? 'log' : 'overview';
  return <JobDetailView jobId={id} tab={tab} />;
}
