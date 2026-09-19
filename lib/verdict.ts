import { keccak256, toHex } from 'viem';
import { assertCanonicalSafe } from './hash';
import type { Decision } from './scoring';

/**
 * Hasil verifikasi dalam bentuk yang bisa diaudit siapa pun.
 *
 * verdictHash(verdict) dikirim ke smart contract saat settle, dan objek
 * penuhnya dipublikasi lewat GET /api/jobs/:id/verdict. Siapa pun bisa
 * mengambil objek itu, menghitung ulang hash-nya, dan mencocokkannya
 * dengan yang tersimpan on-chain. Kalau Oracle memalsukan hasil, ketahuan.
 */
export interface Verdict {
  v: 'GEOv1';
  jobId: number;
  brand: string;
  /** Seed VRF dari on-chain — dasar pemilihan subset. */
  seed: string;
  /** Indeks pertanyaan yang terpilih, terurut naik. */
  subset: number[];
  /** 0/1 per elemen subset, urutannya sejajar dengan `subset`. */
  hits: number[];
  score: number;
  of: number;
  target: number;
  n: number;
  multiEngine: boolean;
  decision: Decision;
}

const SEP = '\n';

/**
 * Kanonikalisasi eksplisit — tidak bergantung urutan properti objek.
 * Alasannya sama dengan canonicalQueryPool: JSON.stringify tidak menjamin
 * urutan, jadi tidak bisa dipakai untuk sesuatu yang harus direproduksi
 * pihak lain.
 */
export function canonicalVerdict(v: Verdict): string {
  // brand ikut masuk string kanonik, jadi tunduk pada batasan yang sama.
  assertCanonicalSafe(v.brand, 'Nama brand');

  return [
    v.v,
    String(v.jobId),
    v.brand,
    v.seed,
    v.subset.join(','),
    v.hits.join(','),
    String(v.score),
    String(v.of),
    String(v.target),
    String(v.n),
    v.multiEngine ? '1' : '0',
    v.decision,
  ].join(SEP);
}

export function verdictHash(v: Verdict): `0x${string}` {
  return keccak256(toHex(canonicalVerdict(v)));
}
