import { formatTBNB } from '@/lib/format';

const SUFFIX = ' tBNB';

/**
 * Jumlah uang untuk DITAMPILKAN: angka tabular, satuan diredam.
 *
 * Angkanya dari formatTBNB() di lib/format.ts (viem formatEther, BigInt) —
 * jangan pernah Number(wei). Komponen ini hanya memisahkan satuannya supaya
 * bisa diberi warna lebih pudar; ia tidak berhitung apa pun.
 *
 * Font mono sengaja TIDAK dipakai untuk uang — mono hanya untuk alamat,
 * hash, dan id teknis (aturan tulisan & angka, blueprint Fase 1).
 */
export function Money({ wei }: { wei: string | bigint }) {
  const s = formatTBNB(wei);
  const value = s.endsWith(SUFFIX) ? s.slice(0, -SUFFIX.length) : s;
  return (
    <span className="num">
      {value}
      <span className="u">tBNB</span>
    </span>
  );
}
