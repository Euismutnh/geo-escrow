/**
 * Tautan ke BscScan Testnet — satu tempat, dipakai semua halaman.
 *
 * Tautan tx hanya dibuat untuk hash yang BENTUKNYA hash transaksi (0x + 64
 * hex). Backend punya hash sentinel ('0xdev', dsb. — lib/chain-server.ts
 * TxResult) yang tidak pernah boleh jadi tautan: BscScan akan menampilkan
 * "not found" dan user mengira transaksinya hilang.
 */
export const SCAN = 'https://testnet.bscscan.com';

const TX_RE = /^0x[0-9a-fA-F]{64}$/;

export function isTxHash(h: string | null | undefined): h is string {
  return !!h && TX_RE.test(h);
}

export const txUrl = (hash: string) => `${SCAN}/tx/${hash}`;
export const addrUrl = (addr: string) => `${SCAN}/address/${addr}`;

/** 0x12345678…abcdef — untuk hash 32-byte (tx, verdict, konten). */
export function shortHash(h: string | null | undefined): string {
  if (!h) return '';
  return h.length > 18 ? `${h.slice(0, 10)}…${h.slice(-6)}` : h;
}
