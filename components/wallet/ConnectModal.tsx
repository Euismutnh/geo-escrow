'use client';

import { useEffect, useRef } from 'react';
import { useConnect, useConnection, useConnectors, type Connector } from 'wagmi';
import { Icon } from '@/components/ui/Icon';
import { isUserRejection, pickConnectors } from '@/lib/tx';

const METAMASK_RDNS = 'io.metamask';
const hasRdns = (c: Connector, rdns: string) => (Array.isArray(c.rdns) ? c.rdns.includes(rdns) : c.rdns === rdns);

/**
 * Logo wallet. Wallet EIP-6963 mengirim ikonnya sendiri (data: URI) —
 * itu yang dipakai, supaya logo di modal = logo di ekstensi user.
 * Konektor cadangan tanpa ikon → huruf pertama namanya.
 */
function WalletLogo({ c, big }: { c: Connector; big?: boolean }) {
  if (c.icon) {
    // eslint-disable-next-line @next/next/no-img-element -- data: URI dari wallet; next/image tidak menambah apa pun di sini
    return <img className="wlogo wlogo-img" src={c.icon} alt="" width={big ? 56 : 36} height={big ? 56 : 36} />;
  }
  return <span className="wlogo" style={{ background: 'var(--mark)' }}>{c.name.slice(0, 1).toUpperCase()}</span>;
}

/**
 * Modal "Hubungkan wallet" (mockup connectModal).
 *
 * Daftarnya = wallet yang BENAR-BENAR terpasang, lewat EIP-6963 — bukan
 * empat kartu tetap. Layar "Pilih akun" di prototipe dibuang (§A4): akun
 * aktif dipilih di ekstensi, wagmi memberi satu.
 *
 * Tidak meminta pindah jaringan saat connect: kalau wallet ada di jaringan
 * lain, banner ChainGuard yang menjelaskannya — lebih jelas daripada dua
 * popup wallet berturut-turut.
 */
export function ConnectModal({ onClose }: { onClose: () => void }) {
  const all = useConnectors();
  const connect = useConnect();
  const firstRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const { status } = useConnection();

  // Tutup begitu terhubung — juga kalau user menekan "Batal" di sini
  // tapi tetap menyetujui popup di wallet (popup-nya tidak bisa dibatalkan
  // dari halaman; koneksinya tetap terjadi).
  useEffect(() => { if (status === 'connected') onClose(); }, [status, onClose]);

  const hasWindowProvider = typeof window !== 'undefined' && 'ethereum' in window;
  const list = pickConnectors(all, hasWindowProvider);
  const showMetaMaskInstall = !list.some((c) => hasRdns(c, METAMASK_RDNS));
  const pending = connect.isPending ? connect.variables?.connector : undefined;
  const pendingConnector = pending && 'uid' in pending ? pending : undefined;

  // Escape menutup; fokus masuk ke modal dan kembali ke pemicunya saat tutup.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      // Pengunci fokus (Fase 10): Tab/Shift+Tab berputar DI DALAM modal —
      // tanpa ini fokus berjalan ke halaman di belakang latar gelap.
      if (e.key !== 'Tab' || !modalRef.current) return;
      const items = [...modalRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      const inside = modalRef.current.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
  }, [onClose]);

  const pick = (c: Connector) => connect.mutate({ connector: c }, { onSuccess: onClose });

  let body;
  if (pendingConnector) {
    body = (
      <div className="connecting">
        <span className="wlogo-wrap"><WalletLogo c={pendingConnector} big /><span className="ring" /></span>
        <h4>Buka {pendingConnector.name}</h4>
        <p>Setujui permintaan koneksi di jendela wallet. Tidak ada transaksi dan tidak ada biaya.</p>
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 14 }} onClick={() => connect.reset()}>Batal</button>
      </div>
    );
  } else if (list.length === 0) {
    body = (
      <div className="empty" style={{ border: 0, padding: '12px 8px 4px' }}>
        <div className="empty-ic"><Icon name="wallet" /></div>
        <h3>Tidak ada wallet terdeteksi</h3>
        <p>Pasang ekstensi wallet di browser ini, lalu muat ulang halaman.</p>
        <a className="btn btn-primary" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer"><Icon name="ext" />Pasang MetaMask</a>
      </div>
    );
  } else {
    body = (
      <div className="wlist">
        {connect.error && (
          isUserRejection(connect.error)
            ? <p className="tx-msg"><Icon name="info" />Permintaan koneksi dibatalkan di wallet.</p>
            : <p className="tx-msg err"><Icon name="alert" />Tidak bisa terhubung. Buka wallet Anda, pastikan tidak terkunci, lalu coba lagi.</p>
        )}
        {list.map((c, i) => (
          <button key={c.uid} ref={i === 0 ? firstRef : undefined} type="button" className="wopt" onClick={() => pick(c)}>
            <WalletLogo c={c} />
            <span><span className="wname">{c.name}</span><span className="wsub">Ekstensi browser</span></span>
            <span className="end"><span className="tag tag-verify">Terdeteksi</span></span>
          </button>
        ))}
        {showMetaMaskInstall && (
          <a className="wopt dim" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
            <span className="wlogo" style={{ background: '#F6851B' }}>M</span>
            <span><span className="wname">MetaMask</span><span className="wsub">Belum terpasang</span></span>
            <span className="end">Pasang <Icon name="ext" className="i-xs" /></span>
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="cm-t" onClick={(e) => e.stopPropagation()}>
        <div className="modal-h">
          <div>
            <h3 id="cm-t">Hubungkan wallet</h3>
            <p>Alamat wallet adalah identitas Anda. Tidak ada akun, tidak ada kata sandi.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup"><Icon name="x" /></button>
        </div>
        <div className="modal-b">{body}</div>
        <div className="modal-f">
          <Icon name="shield" />
          <span>GEO Escrow hanya meminta alamat. Setiap transaksi tetap harus Anda setujui sendiri di wallet.</span>
        </div>
      </div>
    </div>
  );
}
