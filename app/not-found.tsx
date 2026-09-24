import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';

/** Menangani notFound() DAN semua URL yang tidak cocok dengan rute mana pun. Dirender di dalam layout, jadi shell tetap tampil. */
export default function NotFound() {
  return (
    <EmptyState
      icon="alert"
      title="Halaman tidak ditemukan"
      action={<ButtonLink href="/" variant="secondary" icon="left">Kembali ke Ringkasan</ButtonLink>}
    >
      Alamat ini tidak ada di GEO Escrow, atau nomor kontraknya tidak valid.
    </EmptyState>
  );
}
