import type { Metadata } from 'next';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Upcoming } from '@/components/ui/Upcoming';

export const metadata: Metadata = { title: 'Pasar' };

export default function MarketPage() {
  return (
    <>
      <PageHeader
        title="Pasar kontrak"
        sub="Kontrak yang bisa diambil, sedang berjalan, dan sudah selesai."
        action={<ButtonLink href="/create" icon="plus">Buat kontrak</ButtonLink>}
      />
      <Upcoming icon="store" phase={3} what="Daftar kontrak dengan filter Semua, Terbuka, Berjalan, Perlu juri, dan Selesai." />
    </>
  );
}
