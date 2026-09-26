import type { Metadata } from 'next';
import { DashboardView } from '@/components/dashboard/DashboardView';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';

export const metadata: Metadata = { title: 'Ringkasan' };

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
