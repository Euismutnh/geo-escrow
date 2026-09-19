import { keccak256, concatHex, toHex } from 'viem';

/**
 * Ukuran subset yang diverifikasi — sama dengan prototipe:
 * max(3, ceil(n * 0.7)), dibatasi tidak melebihi n.
 *
 * Catatan: untuk n = 3, hasilnya 3 = seluruh pool, jadi VRF tidak
 * berpengaruh apa-apa di kasus itu. Itu wajar, bukan bug.
 */
export function subsetSize(n: number): number {
  return Math.min(n, Math.max(3, Math.ceil(n * 0.7)));
}

/**
 * Pilih subset pertanyaan secara acak-terverifikasi.
 *
 * Fisher-Yates dengan PRNG deterministik yang diturunkan dari seed on-chain
 * (block.prevrandao, disimpan kontrak saat confirmStructural).
 *
 * Kenapa bukan Math.random() seperti prototipe: kalau Oracle yang mengacak
 * di servernya sendiri, ia bisa mengulang undian sampai dapat subset yang
 * menguntungkan, dan tidak ada yang bisa membuktikan. Dengan seed on-chain,
 * siapa pun bisa menghitung ulang subset yang sama persis dan mengecek
 * bahwa Oracle tidak curang.
 */ 
export function deriveSubset(
  seed: `0x${string}`,
  n: number,
  k: number
): number[] {
  if (n <= 0) return [];

  const idx = Array.from({ length: n }, (_, i) => i);

  for (let i = n - 1; i > 0; i--) {
    const h = keccak256(concatHex([seed, toHex(i, { size: 32 })]));
    const j = Number(BigInt(h) % BigInt(i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }

  return idx.slice(0, Math.min(k, n)).sort((a, b) => a - b);
}
