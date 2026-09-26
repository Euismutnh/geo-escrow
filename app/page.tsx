import type { Metadata } from 'next';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

// title.template (layout root) hanya berlaku untuk segmen ANAK — halaman ini
// satu segmen dengan layout root, jadi judul lengkapnya ditulis absolut.
export const metadata: Metadata = { title: { absolute: 'Ringkasan · GEO Escrow' } };

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Ringkasan"
        sub="Dana, kontrak, dan hasil verifikasi Anda dalam satu tempat."
        action={<ButtonLink href="/create" icon="plus">Buat kontrak</ButtonLink>}
      />
      <DashboardView />
    </>
  );
}
