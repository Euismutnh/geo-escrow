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

/**
 * Versi RINGKAS untuk SALDO wallet ("4.6108 tBNB"), yang berisi sisa gas
 * sampai 18 digit. Nominal kontrak (budget, bond) tetap formatTBNB — di
 * sana setiap digit berarti.
 *
 * Dipotong KE BAWAH, tidak pernah dibulatkan ke atas: saldo yang tampil
 * tidak boleh lebih besar dari yang sebenarnya dimiliki. Saldo positif
 * yang terpotong jadi nol ditulis "< 0.0001", bukan "0". Aritmetika
 * string — tanpa Number(), jadi tetap tepat di atas 2^53.
 */
export function formatTBNBShort(wei: string | bigint, decimals = 4): string {
  const full = formatTBNB(wei).slice(0, -' tBNB'.length);
  const neg = full.startsWith('-');
  const abs = neg ? full.slice(1) : full;
  const [int, frac = ''] = abs.split('.');
  const cut = frac.slice(0, decimals).replace(/0+$/, '');
  const shown = cut ? `${int}.${cut}` : int;
  if (shown === '0' && frac !== '') return `${neg ? '> -' : '< '}0.${'0'.repeat(Math.max(decimals - 1, 0))}1 tBNB`;
  return `${neg ? '-' : ''}${shown} tBNB`;
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
  // `new Date('rusak')` TIDAK melempar — ia menghasilkan Invalid Date, dan
  // toLocaleString mencetak teks "Invalid Date" ke layar. Jadi try/catch
  // saja tidak cukup; tanggal harus diperiksa eksplisit.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * "baru saja", "5 menit lalu", "2 jam lalu", "dalam 3 hari".
 * `now` bisa disuntik untuk pengujian. Tanggal tidak valid -> ''.
 *
 * Hanya untuk komponen yang dirender di KLIEN: nilainya bergantung pada jam
 * saat ini, jadi kalau dirender di server hasilnya bisa berbeda dengan di
 * browser (hydration mismatch).
 */
export function formatRelative(iso: string | number | Date, now: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = t - now, a = Math.abs(diff), MIN = 60_000, H = 60 * MIN, D = 24 * H;
  if (a < MIN) return diff > 0 ? 'sebentar lagi' : 'baru saja';
  const s = a < H ? `${Math.round(a / MIN)} menit` : a < D ? `${Math.round(a / H)} jam` : `${Math.round(a / D)} hari`;
  return diff > 0 ? `dalam ${s}` : `${s} lalu`;
}
