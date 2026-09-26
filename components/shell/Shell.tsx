import Link from 'next/link';
import type { ReactNode } from 'react';
import { bscTestnet } from 'viem/chains';
import { AccountButton } from '@/components/wallet/AccountButton';
import { NetBanner, NetPill } from '@/components/wallet/ChainGuard';
import { WalletMini } from '@/components/wallet/WalletMini';
import { BrandMark } from './BrandMark';
import { Crumbs } from './Crumbs';
import { HelpButton } from './HelpButton';
import { NavLinks } from './NavLinks';

/**
 * Kerangka aplikasi: sidebar + topbar + area konten.
 *
 * Server Component. Yang butuh interaksi dipisah jadi pulau klien kecil
 * (NavLinks, Crumbs, HelpButton, dan sejak Fase 5: WalletMini, NetPill,
 * AccountButton, NetBanner) — pola "Reducing JS bundle size" di
 * dokumentasi Next.js 16. Karena hidup di layout, shell ini TIDAK
 * di-render ulang saat berpindah halaman.
 *
 * Chain ID diambil dari viem (bscTestnet.id), bukan diketik ulang.
 */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="app">
      <aside className="side">
        <Link className="brand" href="/">
          <BrandMark size={28} />
          <span className="brand-txt">
            <span className="brand-name">GEO Escrow</span>
            <span className="brand-sub">Escrow berbasis hasil AI</span>
          </span>
        </Link>
        <NavLinks />
        <div className="side-foot">
          <WalletMini />
          <div className="side-meta"><span>BNB Smart Chain Testnet · {bscTestnet.id}</span></div>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <Link className="top-brand" href="/" aria-label="Beranda"><BrandMark size={26} /></Link>
          <Crumbs />
          <div className="top-r">
            <NetPill />
            <HelpButton />
            <AccountButton />
          </div>
        </header>
        <main className="content" id="main">
          <NetBanner />
          {children}
        </main>
      </div>
    </div>
  );
}
