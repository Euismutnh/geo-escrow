'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useDisconnect } from 'wagmi';
import { Icon } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { addrUrl } from '@/lib/explorer';
import { shortAddr } from '@/lib/format';
import { Avatar } from './Avatar';
import { useTbnbBalance, useWallet } from './useWallet';
import { useWalletUi } from './WalletUi';

/** Saldo tBNB, atau keadaan memuat/gagal yang jujur (bukan "0"). */
export function WalletBalance({ address }: { address: string }) {
  const b = useTbnbBalance(address);
  if (b.isPending) return <span className="faint">…</span>;
  if (b.isError) return <span className="faint" title="Saldo tidak terbaca dari RPC">—</span>;
  return <Money wei={b.data.value} short />;
}

function Menu({ address, walletName, onClose }: { address: string; walletName: string; onClose: () => void }) {
  const disconnect = useDisconnect();
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);

  const copy = async () => {
    try { await navigator.clipboard.writeText(address); setCopied('ok'); }
    catch { setCopied('fail'); }
  };

  return (
    <div className="menu" role="menu">
      <div className="menu-h">
        <div className="row">
          <Avatar address={address} size={34} />
          <div>
            <div style={{ fontSize: 12, color: 'var(--faint)' }}>{walletName} · BNB Smart Chain Testnet</div>
            <div className="mono" style={{ fontSize: 13 }} title={address}>{shortAddr(address)}</div>
          </div>
        </div>
        <div className="menu-bal"><WalletBalance address={address} /></div>
      </div>
      <div className="menu-list">
        <button type="button" role="menuitem" onClick={copy}>
          <Icon name={copied === 'ok' ? 'check' : 'copy'} />
          {copied === 'ok' ? 'Alamat disalin' : copied === 'fail' ? 'Tidak bisa menyalin — salin manual dari wallet' : 'Salin alamat'}
        </button>
        <a role="menuitem" href={addrUrl(address)} target="_blank" rel="noopener noreferrer"><Icon name="ext" />Lihat di BscScan</a>
        <Link role="menuitem" href="/my-jobs" onClick={onClose}><Icon name="folder" />Kontrak saya</Link>
        <button type="button" role="menuitem" className="danger" onClick={() => { disconnect.mutate(); onClose(); }}>
          <Icon name="logout" />Putuskan koneksi
        </button>
      </div>
    </div>
  );
}

/**
 * Pojok kanan topbar: tombol "Hubungkan wallet", atau alamat + menu akun.
 * Selama wagmi memulihkan koneksi setelah muat ulang, tampil tombol akun
 * yang menunggu — bukan ajakan menghubungkan yang akan hilang sedetik lagi.
 */
export function AccountButton() {
  const w = useWallet();
  const { openConnect } = useWalletUi();
  // Menu tercatat terbuka UNTUK alamat tertentu: kalau akun diganti atau
  // diputus dari ekstensi, menu lama otomatis tertutup — tanpa efek.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = !!w.address && openFor === w.address;
  const setOpen = (v: boolean) => setOpenFor(v && w.address ? w.address : null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpenFor(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenFor(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (w.restoring) {
    return <button type="button" className="acct" disabled aria-busy="true"><span className="spin" aria-hidden="true" /><span className="hide-sm">{w.status === 'connecting' ? 'Menghubungkan…' : 'Memulihkan wallet…'}</span></button>;
  }
  if (!w.address) {
    return (
      <button type="button" className="btn btn-primary btn-sm" onClick={openConnect}>
        <Icon name="wallet" />
        <span className="hide-sm">Hubungkan wallet</span>
        <span className="show-sm">Hubungkan</span>
      </button>
    );
  }
  return (
    <div className="acct-wrap" ref={wrap}>
      <button type="button" className="acct" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={w.address}>
        <Avatar address={w.address} size={22} />
        <span className="mono">{shortAddr(w.address)}</span>
        <Icon name="down" className="i-sm" />
      </button>
      {open && <Menu address={w.address} walletName={w.walletName} onClose={() => setOpen(false)} />}
    </div>
  );
}
