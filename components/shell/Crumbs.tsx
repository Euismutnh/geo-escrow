'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { parseJobIdParam } from '@/lib/route-params';
import { titleFor } from './nav';

/**
 * Breadcrumb topbar. Nama brand di halaman detail belum diketahui di sini
 * (shell tidak mengambil data), jadi yang tampil nomor kontraknya.
 */
export function Crumbs() {
  const pathname = usePathname();
  const home = (
    <>
      <Link href="/" className="hide-sm-c">GEO Escrow</Link>
      <span className="sep hide-sm-c">/</span>
    </>
  );

  if (pathname.startsWith('/jobs/')) {
    const id = parseJobIdParam(pathname.split('/')[2]);
    return (
      <nav className="crumbs" aria-label="Breadcrumb">
        {home}
        <Link href="/market" className="hide-sm-c">Pasar</Link>
        <span className="sep hide-sm-c">/</span>
        <span className="cur">{id === null ? 'Tidak ditemukan' : `Kontrak #${id}`}</span>
      </nav>
    );
  }

  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {home}
      <span className="cur">{titleFor(pathname) ?? 'Tidak ditemukan'}</span>
    </nav>
  );
}
