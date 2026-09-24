import { UI_STATUS_META, type UiStatus } from '@/lib/status';
import { Icon, type IconName } from './Icon';

/**
 * Badge status — label & kelas warna DIIMPOR dari lib/status.ts, bukan
 * disalin. Terima UiStatus hasil deriveUiStatus(job), jangan job.status
 * mentah (on-chain cuma 7 status, UI punya 13).
 *
 * Tiap nada punya ikon sendiri, supaya status tetap terbedakan tanpa warna.
 */
const TONE_ICON: Record<string, IconName> = {
  'st-mint': 'check',
  'st-rose': 'x',
  'st-warn': 'alert',
  'st-violet': 'dot',
  'st-amber': 'clock',
};

export function StatusBadge({ status, size }: { status: UiStatus; size?: 'lg' }) {
  const m = UI_STATUS_META[status];
  return (
    <span className={`badge ${m.cls}${size === 'lg' ? ' badge-lg' : ''}`}>
      {m.spin ? <span className="spin" aria-hidden="true" /> : <Icon name={TONE_ICON[m.cls] ?? 'dot'} />}
      {m.label}
    </span>
  );
}
