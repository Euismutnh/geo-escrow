import { EmptyState } from './EmptyState';
import type { IconName } from './Icon';

/**
 * Penanda sementara untuk halaman yang kerangkanya sudah ada tapi isinya
 * belum. HANYA untuk masa pembangunan — dihapus di fase yang disebut.
 */
export function Upcoming({ icon, what, phase }: { icon: IconName; what: string; phase: number }) {
  return (
    <EmptyState icon={icon} title="Sedang dibangun" note={`Menyusul di Fase ${phase}`}>
      {what}
    </EmptyState>
  );
}
