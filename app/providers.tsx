'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { WagmiProvider } from 'wagmi';
import { WalletUiProvider } from '@/components/wallet/WalletUi';
import { ApiClientError } from '@/lib/api';
import { createWagmiConfig } from '@/lib/wagmi';

/**
 * Provider klien untuk seluruh aplikasi. Membungkus Shell (tombol wallet
 * ada di shell), bukan hanya {children}.
 *
 * QueryClient dan config wagmi dibuat di dalam useState: satu instance per
 * tab browser, dan di server satu per request — tidak pernah dibagi antar
 * pengguna. wagmi memakai QueryClient yang SAMA untuk cache-nya (saldo,
 * readContract), jadi satu invalidasi menjangkau keduanya.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [wagmiConfig] = useState(createWagmiConfig);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data rantai berubah lewat transaksi, bukan tiap detik. Polling
            // untuk status yang sedang berjalan datang di Fase 9.
            staleTime: 15_000,
            refetchOnWindowFocus: true,
            // Jangan ulangi 4xx: permintaan yang salah tetap salah kalau
            // diulang. Ulangi sekali untuk jaringan/5xx.
            retry: (count, err) =>
              !(err instanceof ApiClientError && err.status >= 400 && err.status < 500) && count < 1,
          },
        },
      })
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={client}>
        <WalletUiProvider>{children}</WalletUiProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
