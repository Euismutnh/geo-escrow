'use client';

import { useBalance, useConnection, useSwitchChain } from 'wagmi';
import { ADD_CHAIN_PARAMS, CHAIN } from '@/lib/wagmi';

/**
 * Keadaan wallet yang sudah dinormalkan — SATU tempat semua komponen
 * membaca "siapa yang terhubung, di jaringan apa".
 *
 * `wrongChain` membandingkan chainId, BUKAN `connection.chain`: wagmi
 * mengisi `chain` dengan undefined kalau wallet ada di jaringan yang tidak
 * dikonfigurasi, sementara `chainId` tetap terisi (dicek di tipe
 * GetConnectionReturnType @wagmi/core v3).
 *
 * `restoring`: wagmi sedang memulihkan koneksi setelah muat ulang. Selama
 * itu jangan tampilkan ajakan "Hubungkan wallet" — koneksinya sedang
 * kembali sendiri (blueprint Fase 5, verifikasi #4).
 */
export function useWallet() {
  const c = useConnection();
  const connected = c.status === 'connected';
  const wrongChain = connected && c.chainId !== CHAIN.id;
  return {
    status: c.status,
    connected,
    restoring: c.status === 'reconnecting' || c.status === 'connecting',
    /** Hanya terisi saat benar-benar terhubung. */
    address: connected ? c.address : undefined,
    chainId: c.chainId,
    wrongChain,
    /** Terhubung DAN di BSC Testnet — satu-satunya keadaan boleh bertransaksi. */
    ready: connected && !wrongChain,
    walletName: c.connector?.name ?? 'Wallet',
  };
}

/** Saldo tBNB sebuah alamat di BSC Testnet (bukan di jaringan wallet saat ini). */
export function useTbnbBalance(address: `0x${string}` | string | null | undefined) {
  return useBalance({
    address: address as `0x${string}` | undefined,
    chainId: CHAIN.id,
    query: { enabled: !!address },
  });
}

/**
 * Pindah ke BSC Testnet. Kalau wallet belum mengenal chain 97, wagmi
 * memanggil wallet_addEthereumChain dengan parameter ini — RPC publik
 * kita, bukan RPC bawaan viem yang sering kena rate limit.
 */
export function useSwitchToBsc() {
  const s = useSwitchChain();
  return {
    switchToBsc: () => s.mutate({ chainId: CHAIN.id, addEthereumChainParameter: ADD_CHAIN_PARAMS }),
    isPending: s.isPending,
    error: s.error,
    reset: s.reset,
  };
}
