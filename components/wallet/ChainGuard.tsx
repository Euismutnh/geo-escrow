'use client';

import { Icon } from '@/components/ui/Icon';
import { chainName, isUserRejection } from '@/lib/tx';
import { CHAIN } from '@/lib/wagmi';
import { useSwitchToBsc, useWallet } from './useWallet';

/**
 * Penjaga jaringan (blueprint Fase 5). Tanpa ini, transaksi terkirim ke
 * chain yang salah dan gagal dengan pesan yang tidak menyebut jaringan.
 *
 * Wallet yang pindah jaringan di ekstensi memancarkan `chainChanged`;
 * wagmi meneruskannya ke useConnection(), jadi banner ini muncul/hilang
 * sendiri tanpa muat ulang (verifikasi #2).
 */

/** Pil jaringan di topbar. Saat salah jaringan, ia sekaligus tombol pindah. */
export function NetPill() {
  const w = useWallet();
  const { switchToBsc, isPending } = useSwitchToBsc();
  if (w.wrongChain) {
    return (
      <button type="button" className="net bad" onClick={switchToBsc} disabled={isPending} title={`Pindah ke ${CHAIN.name}`}>
        <i className="net-dot" /><span>Jaringan salah</span>
      </button>
    );
  }
  return (
    <span className="net" title={`${CHAIN.name} · chain ID ${CHAIN.id}`}>
      <i className="net-dot" />
      <span className="hide-sm">BNB Testnet</span>
      <span className="show-sm">Testnet</span>
    </span>
  );
}

/** Banner di atas konten halaman. */
export function NetBanner() {
  const w = useWallet();
  const { switchToBsc, isPending, error } = useSwitchToBsc();
  if (!w.wrongChain) return null;

  // Ditolak di wallet = keputusan user, bukan kegagalan. Selain itu (wallet
  // tidak mendukung pindah otomatis): beri tahu cara manualnya.
  const failed = error && !isUserRejection(error);
  return (
    <div className="netbar netbar-w" role="alert">
      <div className="note">
        <Icon name="alert" />
        <div>
          <b>Wallet terhubung ke {chainName(w.chainId)}.</b> GEO Escrow berjalan di {CHAIN.name} (chain ID {CHAIN.id}).
          Transaksi dinonaktifkan sampai Anda pindah jaringan.
          {failed && <div style={{ marginTop: 6 }}>Wallet tidak bisa pindah otomatis — pilih {CHAIN.name} secara manual di wallet Anda.</div>}
        </div>
      </div>
      <button type="button" className="btn btn-secondary btn-sm" onClick={switchToBsc} disabled={isPending}>
        {isPending ? <span className="spin" aria-hidden="true" /> : <Icon name="refresh" />}
        {isPending ? 'Setujui di wallet…' : 'Pindah ke BNB Testnet'}
      </button>
    </div>
  );
}
