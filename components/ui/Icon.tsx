import type { ReactNode } from 'react';

/**
 * Ikon garis 1.75 gaya Lucide — dipindah dari mockup Fase 1.
 *
 * Sengaja ditulis sebagai JSX, bukan string HTML + dangerouslySetInnerHTML,
 * dan tanpa 'use client': modul ini murni, jadi bisa dipakai di Server
 * Component maupun Client Component tanpa menambah bundle klien.
 * Ikon baru ditambah di sini saat halamannya dibangun, bukan di muka.
 */
const PATHS = {
  dash: (<><rect x="3.5" y="3.5" width="7" height="8.5" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.6" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.6" /><rect x="3.5" y="15" width="7" height="5.5" rx="1.6" /></>),
  store: (<><path d="M4 10.2V20h16v-9.8" /><path d="M3 10a2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 5.2 0 2.6 2.6 0 0 0 2.4-2.6L19.3 4H4.7L3 7.4" /><path d="M9.5 20v-5h5v5" /></>),
  plus: (<><rect x="3.5" y="3.5" width="17" height="17" rx="4" /><path d="M12 8.5v7M8.5 12h7" /></>),
  folder: (<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5H9l2 2h7.5a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />),
  radar: (<><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l6-6" /><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" /></>),
  ledger: (<><path d="M9 6.5h11M9 12h11M9 17.5h11" /><circle cx="4.8" cy="6.5" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.8" cy="12" r="1.1" fill="currentColor" stroke="none" /><circle cx="4.8" cy="17.5" r="1.1" fill="currentColor" stroke="none" /></>),
  wallet: (<><rect x="3" y="6" width="18" height="13.5" rx="2.5" /><path d="M3 10h18" /><path d="M16.5 14.8h1.5" /><path d="M6 6V5.2A1.2 1.2 0 0 1 7.2 4h9.6A1.2 1.2 0 0 1 18 5.2V6" /></>),
  help: (<><circle cx="12" cy="12" r="9" /><path d="M9.6 9.3a2.5 2.5 0 1 1 3.6 2.3c-.7.3-1.2 1-1.2 1.8v.3M12 17h.01" /></>),
  info: (<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.8h.01" /></>),
  check: (<path d="M5 12.5l4.5 4.5L19 7.5" />),
  x: (<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />),
  alert: (<><path d="M10.3 4.2L2.9 17.3A2 2 0 0 0 4.6 20.3h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 17h.01" /></>),
  clock: (<><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3 2" /></>),
  dot: (<circle cx="12" cy="12" r="4.2" fill="currentColor" stroke="none" />),
  ext: (<><path d="M14 4h6v6M20 4l-8.5 8.5" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>),
  file: (<><path d="M14 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V9z" /><path d="M14 3.5V9h5.5M8.5 13h7M8.5 16.5h4.5" /></>),
  left: (<path d="M15 18l-6-6 6-6" />),
  arrow: (<path d="M5 12h14M13 6l6 6-6 6" />),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={className ? `i ${className}` : 'i'} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {PATHS[name]}
    </svg>
  );
}
