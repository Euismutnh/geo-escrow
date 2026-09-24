import Link from 'next/link';
import type { ReactNode } from 'react';
import { bscTestnet } from 'viem/chains';
import { Icon } from '@/components/ui/Icon';
import { BrandMark } from './BrandMark';
import { Crumbs } from './Crumbs';
import { HelpButton } from './HelpButton';
import { NavLinks } from './NavLinks';

/**
 * Kerangka aplikasi: sidebar + topbar + area konten.
 *
 * Server Component. Yang butuh interaksi dipisah jadi pulau klien kecil
 * (NavLinks, Crumbs, HelpButton) — pola "Reducing JS bundle size" di
 * dokumentasi Next.js 16. Karena hidup di layout, shell ini TIDAK
 * di-render ulang saat berpindah halaman.
 *
 * Wallet belum tersambung di fase ini: tombolnya dinonaktifkan sampai
 * Fase 5 memasang wagmi. Chain ID diambil dari viem (bscTestnet.id), bukan
 * diketik ulang, supaya tidak bisa melenceng dari konfigurasi chain.
 */
export function Shell({ children }: { children: ReactNode }) {
  const walletSoon = 'Koneksi wallet tersedia di Fase 5';
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
          <div className="wmini">
            <p>Hubungkan wallet untuk membuat atau mengambil kontrak.</p>
            <button type="button" className="btn btn-primary btn-sm btn-block" disabled title={walletSoon}>
              <Icon name="wallet" />Hubungkan wallet
            </button>
          </div>
          <div className="side-meta"><span>BNB Smart Chain Testnet · {bscTestnet.id}</span></div>
        </div>
      </aside>

      <div className="main">
        <header className="top">
          <Link className="top-brand" href="/" aria-label="Beranda"><BrandMark size={26} /></Link>
          <Crumbs />
          <div className="top-r">
            <span className="net" title={`BNB Smart Chain Testnet · chain ID ${bscTestnet.id}`}>
              <i className="net-dot" />
              <span className="hide-sm">BNB Testnet</span>
              <span className="show-sm">Testnet</span>
            </span>
            <HelpButton />
            <button type="button" className="btn btn-primary btn-sm" disabled title={walletSoon}>
              <Icon name="wallet" />
              <span className="hide-sm">Hubungkan wallet</span>
              <span className="show-sm">Hubungkan</span>
            </button>
          </div>
        </header>
        <main className="content" id="main">{children}</main>
      </div>
    </div>
  );
}
