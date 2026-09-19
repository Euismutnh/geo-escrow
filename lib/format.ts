import { formatEther, parseEther } from 'viem';

/**
 * Format wei -> "0.02 tBNB".
 *
 * Memakai formatEther milik viem, BUKAN Number(wei) / 1e18: di atas 2^53
 * (~0,009 tBNB) pembagian dengan Number kehilangan presisi diam-diam.
 */
export function formatTBNB(wei: string | bigint): string {
  const s = formatEther(typeof wei === 'string' ? BigInt(wei) : wei);

  // Rapikan nol di belakang koma ("0.0200" -> "0.02"), tapi hanya kalau
  // memang ada koma — supaya "10" tidak ikut terpangkas jadi "1".
  const trimmed = s.includes('.')
    ? s.replace(/0+$/, '').replace(/\.$/, '')
    : s;

  return (trimmed === '' || trimmed === '-0' ? '0' : trimmed) + ' tBNB';
}

/** "0.02" -> "20000000000000000" (string, bukan number). */
export function toWei(tbnb: string | number): string {
  return parseEther(String(tbnb)).toString();
}

/** 0x71c7...8976 */
export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return '';
  return addr.length <= 12 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Format tanggal gaya Indonesia, sama seperti fmtTime() di prototipe. */
export function formatTime(iso: string | number | Date): string {
  try {
    return new Date(iso).toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}
