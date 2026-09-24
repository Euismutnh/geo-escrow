import type { IconName } from '@/components/ui/Icon';

export interface NavItem {
  href: string;
  label: string;
  /** Label pendek untuk tab bar ponsel. */
  short: string;
  icon: IconName;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Kontrak',
    items: [
      { href: '/', label: 'Ringkasan', short: 'Ringkasan', icon: 'dash' },
      { href: '/market', label: 'Pasar', short: 'Pasar', icon: 'store' },
      { href: '/create', label: 'Buat kontrak', short: 'Buat', icon: 'plus' },
      { href: '/my-jobs', label: 'Kontrak saya', short: 'Kontrakku', icon: 'folder' },
    ],
  },
  {
    group: 'Transparansi',
    items: [
      { href: '/oracle-log', label: 'Log Oracle', short: 'Oracle', icon: 'radar' },
      { href: '/activity', label: 'Aktivitas', short: 'Aktivitas', icon: 'ledger' },
    ],
  },
];

/**
 * Item nav mana yang aktif untuk sebuah pathname.
 * Halaman detail kontrak (/jobs/:id) dianggap bagian dari Pasar.
 */
export function activeHref(pathname: string): string | null {
  if (pathname === '/') return '/';
  if (pathname.startsWith('/jobs/')) return '/market';
  for (const g of NAV) for (const it of g.items) {
    if (it.href !== '/' && (pathname === it.href || pathname.startsWith(it.href + '/'))) return it.href;
  }
  return null;
}

export function titleFor(pathname: string): string | null {
  for (const g of NAV) for (const it of g.items) if (it.href === pathname) return it.label;
  return null;
}
