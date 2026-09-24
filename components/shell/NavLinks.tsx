'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { NAV, activeHref } from './nav';

/**
 * Satu-satunya bagian sidebar yang butuh 'use client' — karena usePathname().
 * Sisa shell tetap Server Component supaya tidak ikut ke bundle klien.
 *
 * usePathname() aman dipakai langsung di sini: dokumentasi Next.js 16
 * memperingatkan hydration mismatch hanya kalau halaman dicapai lewat
 * REWRITE. proxy.ts hanya mencocokkan /api/:path* dan tidak pernah
 * me-rewrite; next.config.ts tidak punya rewrites.
 */
export function NavLinks() {
  const active = activeHref(usePathname());
  return (
    <nav className="nav" aria-label="Navigasi utama">
      {NAV.map((g) => (
        <div className="nav-group" key={g.group}>
          <div className="nav-label">{g.group}</div>
          {g.items.map((it) => (
            <Link
              key={it.href}
              href={it.href}
              className="nav-link"
              title={it.label}
              aria-current={active === it.href ? 'page' : undefined}
            >
              <Icon name={it.icon} />
              <span className="nl-full">{it.label}</span>
              <span className="nl-short">{it.short}</span>
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
