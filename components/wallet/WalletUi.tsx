'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ConnectModal } from './ConnectModal';

/**
 * Satu modal koneksi untuk seluruh aplikasi. Tombol "Hubungkan wallet"
 * ada di banyak tempat (topbar, sidebar, dashboard, Kontrak saya,
 * <TxButton>) — semuanya membuka modal yang SAMA lewat openConnect().
 */
const Ctx = createContext<{ openConnect: () => void } | null>(null);

export function WalletUiProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openConnect = useCallback(() => setOpen(true), []);
  // Stabil: efek fokus & kunci-scroll di modal bergantung padanya.
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ openConnect }), [openConnect]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open && <ConnectModal onClose={close} />}
    </Ctx.Provider>
  );
}

export function useWalletUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWalletUi() harus dipakai di dalam <WalletUiProvider>');
  return v;
}
