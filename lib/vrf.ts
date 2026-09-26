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

const B32 = /^0x[0-9a-fA-F]{64}$/;

/**
 * Seed efektif GEOv2 (temuan audit S-04).
 *
 * Di BSC, `block.prevrandao` yang disimpan kontrak sebagai verificationSeed
 * praktis KONSTAN (terukur: 2). Dengan seed itu saja, subset bisa dihitung
 * siapa pun jauh sebelum verifikasi — freelancer tinggal mengoptimasi
 * konten untuk pertanyaan yang ia tahu akan terpilih.
 *
 * Seed efektif mencampur bahan yang semuanya PUBLIK dan TERKUNCI sebelum
 * verifikasi, tapi TIDAK diketahui freelancer saat ia menandatangani:
 *   seedOnChain       — dari kontrak (tetap disertakan)
 *   confirmBlockHash  — hash blok tempat confirmStructural masuk; blok itu
 *                       belum ada saat submitDeliverable
 *   jobId             — supaya dua job di blok yang sama tidak berbagi subset
 *   deliverableHash   — mengikat undian ke konten yang ditandatangani
 * Siapa pun bisa menghitung ulang: keccak256(seed ‖ blockHash ‖ uint256(jobId) ‖ deliverableHash).
 */
export function effectiveSeedV2(p: {
  seed: string;
  confirmBlockHash: string;
  jobId: number;
  deliverableHash: string;
}): `0x${string}` {
  for (const [nama, v] of [['seed', p.seed], ['confirmBlockHash', p.confirmBlockHash], ['deliverableHash', p.deliverableHash]] as const) {
    if (!B32.test(v)) throw new Error(`effectiveSeedV2: ${nama} harus bytes32 (0x + 64 heksa)`);
  }
  if (!Number.isSafeInteger(p.jobId) || p.jobId < 0) throw new Error('effectiveSeedV2: jobId tidak sah');
  return keccak256(concatHex([
    p.seed.toLowerCase() as `0x${string}`,
    p.confirmBlockHash.toLowerCase() as `0x${string}`,
    toHex(p.jobId, { size: 32 }),
    p.deliverableHash.toLowerCase() as `0x${string}`,
  ]));
}
