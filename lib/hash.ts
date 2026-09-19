import { keccak256, toHex } from 'viem';

/**
 * Pemisah field di semua string kanonik.
 *
 * Karena '\n' yang memisahkan field, tidak ada NILAI field yang boleh
 * mengandung '\n' — kalau boleh, dua input berbeda bisa menghasilkan string
 * kanonik yang sama (ambiguitas kanonikalisasi). Hash-nya jadi bentrok, dan
 * karena queryPoolHash adalah GERBANG KEASLIAN data (lihat §5.3 blueprint),
 * itu berarti gerbangnya bisa ditembus. Jadi ini bukan soal kerapian —
 * ini batas keamanan.
 */
const SEP = '\n';

/** Tolak nilai yang bisa merusak kanonikalisasi. */
export function assertCanonicalSafe(value: string, field: string): void {
  if (value.includes(SEP)) {
    throw new Error(`${field} tidak boleh mengandung baris baru`);
  }
  // \r juga berbahaya: file dari Windows bisa menyelipkannya, dan
  // "abc\r" vs "abc" akan menghasilkan hash berbeda secara tak terduga.
  if (value.includes('\r')) {
    throw new Error(`${field} tidak boleh mengandung carriage return`);
  }
}

export interface QueryPoolInput {
  brand: string;
  queries: string[];
  targetCount: number;
  multiEngine: boolean;
}

/**
 * String kanonik untuk query pool.
 *
 * Urutan dan format dikunci eksplisit — sengaja TIDAK memakai
 * JSON.stringify, yang hasilnya bergantung pada urutan properti objek.
 * Kalau FE menulis {targetCount, queries} dan BE menulis {queries,
 * targetCount}, JSON.stringify menghasilkan string berbeda → hash berbeda →
 * verifikasi selalu gagal walau datanya identik.
 */
export function canonicalQueryPool(i: QueryPoolInput): string {
  const brand = i.brand.trim();
  const queries = i.queries.map((q) => q.trim());

  assertCanonicalSafe(brand, 'Nama brand');
  queries.forEach((q, idx) => assertCanonicalSafe(q, `Pertanyaan #${idx + 1}`));

  if (!brand) throw new Error('Nama brand tidak boleh kosong');
  if (!Number.isInteger(i.targetCount)) {
    throw new Error('targetCount harus bilangan bulat');
  }

  return [
    'GEOv1', // versi skema — naikkan kalau format ini pernah berubah
    brand,
    String(i.targetCount),
    i.multiEngine ? '1' : '0',
    String(queries.length),
    ...queries,
  ].join(SEP);
}

export function queryPoolHash(i: QueryPoolInput): `0x${string}` {
  return keccak256(toHex(canonicalQueryPool(i)));
}

/** Hash isi deliverable — dibandingkan dengan yang di-commit on-chain. */
export function contentHash(content: string): `0x${string}` {
  return keccak256(toHex(content));
}
