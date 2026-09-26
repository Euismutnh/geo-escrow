import { createConfig, http, injected } from 'wagmi';
import { bscTestnet } from 'viem/chains';
import { SCAN } from './explorer';

/*
 * Konfigurasi wallet — SATU chain: BNB Smart Chain Testnet (97).
 *
 * Chain ID diimpor dari viem (bscTestnet.id), tidak diketik ulang di env,
 * supaya tidak bisa melenceng dari definisi chain (blueprint Fase 0 §3).
 */
export const CHAIN = bscTestnet;

/**
 * RPC PUBLIK untuk browser. `NEXT_PUBLIC_*` disisipkan saat BUILD — di
 * Vercel variabelnya harus ada sebelum build, bukan sesudah deploy.
 *
 * Jangan pernah mengisinya dengan RPC_URL milik server: URL itu memuat
 * kunci, dan semua yang berawalan NEXT_PUBLIC_ terbaca siapa pun di
 * bundle JavaScript. scripts/check-security.ts menolak keduanya sama.
 *
 * Tanpa nilai: RPC bawaan viem (gratis, sering kena rate limit) — cukup
 * supaya halaman tetap hidup, dengan peringatan di konsol pengembangan.
 */
export const PUBLIC_RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || CHAIN.rpcUrls.default.http[0];
if (!process.env.NEXT_PUBLIC_RPC_URL && process.env.NODE_ENV !== 'production') {
  console.warn('[wagmi] NEXT_PUBLIC_RPC_URL kosong — memakai RPC bawaan viem.');
}

/** Dipakai switchChain saat wallet belum mengenal chain 97 (wallet_addEthereumChain). */
export const ADD_CHAIN_PARAMS = {
  chainName: CHAIN.name,
  nativeCurrency: CHAIN.nativeCurrency,
  rpcUrls: [PUBLIC_RPC_URL],
  blockExplorerUrls: [SCAN],
};

/**
 * Dibuat per Provider (useState di app/providers.tsx), bukan singleton
 * modul: di server satu modul dipakai bersama semua request.
 *
 * - multiInjectedProviderDiscovery (EIP-6963): tiap wallet terpasang
 *   mengumumkan dirinya sendiri — MetaMask dan Coinbase tidak lagi
 *   berebut satu `window.ethereum` (blueprint Fase 5).
 * - injected() polos tetap ada sebagai CADANGAN untuk wallet lama / in-app
 *   browser yang belum mendukung EIP-6963. Ia tidak punya rdns, jadi wagmi
 *   tidak bisa menyatukannya dengan entri EIP-6963 — modal menyembunyikannya
 *   selama ada satu saja wallet EIP-6963 (lihat pickConnectors()).
 * - ssr: true — render pertama di klien = render server (terputus), lalu
 *   Hydrate milik wagmi memulihkan koneksi setelah mount. Halaman statis
 *   tetap statis (tanpa cookies() di layout), dan tidak ada hydration
 *   mismatch. Diperiksa di sumber @wagmi/core/hydrate.js: onMount juga
 *   menambahkan wallet EIP-6963 yang mengumumkan diri sebelum hidrasi.
 */
export function createWagmiConfig() {
  return createConfig({
    chains: [CHAIN],
    transports: { [CHAIN.id]: http(PUBLIC_RPC_URL) },
    connectors: [injected()],
    multiInjectedProviderDiscovery: true,
    ssr: true,
  });
}

declare module 'wagmi' {
  interface Register {
    config: ReturnType<typeof createWagmiConfig>;
  }
}
