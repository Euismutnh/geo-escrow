'use client';

import { Icon } from '@/components/ui/Icon';
import { shortAddr } from '@/lib/format';
import { WalletBalance } from './AccountButton';
import { Avatar } from './Avatar';
import { useWallet } from './useWallet';
import { useWalletUi } from './WalletUi';

/** Kartu wallet kecil di kaki sidebar (mockup walletMini). */
export function WalletMini() {
  const w = useWallet();
  const { openConnect } = useWalletUi();

  if (w.restoring) {
    return <div className="wmini" aria-busy="true"><p style={{ margin: 0 }}>{w.status === 'connecting' ? 'Menunggu persetujuan di wallet…' : 'Memulihkan koneksi wallet…'}</p></div>;
  }
  if (!w.address) {
    return (
      <div className="wmini">
        <p>Hubungkan wallet untuk membuat atau mengambil kontrak.</p>
        <button type="button" className="btn btn-primary btn-sm btn-block" onClick={openConnect}>
          <Icon name="wallet" />Hubungkan wallet
        </button>
      </div>
    );
  }
  return (
    <div className="wmini">
      <div className="wmini-top">
        <Avatar address={w.address} size={28} />
        <div>
          <div className="wmini-prov">{w.walletName}</div>
          <div className="wmini-addr mono" title={w.address}>{shortAddr(w.address)}</div>
        </div>
      </div>
      <div className="wmini-bal">
        {w.wrongChain ? <span className="wmini-warn"><Icon name="alert" className="i-xs" />Jaringan salah</span> : <WalletBalance address={w.address} />}
      </div>
    </div>
  );
}
