import { keccak256, toHex } from 'viem';
import { assertCanonicalSafe } from './hash';
import type { Decision } from './scoring';
import { deriveSubset, effectiveSeedV2, subsetSize } from './vrf';

/**
 * Hasil verifikasi dalam bentuk yang bisa diaudit siapa pun.
 *
 * verdictHash(verdict) dikirim ke smart contract saat settle, dan objek
 * penuhnya dipublikasi lewat GET /api/jobs/:id/verdict. Siapa pun bisa
 * mengambil objek itu, menghitung ulang hash-nya, dan mencocokkannya
 * dengan yang tersimpan on-chain. Kalau Oracle memalsukan hasil, ketahuan.
 *
 * DUA VERSI, keduanya tetap sah:
 *   GEOv1 — subset dari `seed` on-chain saja. Dipakai verdict sebelum
 *           27-09-2026 (job 0 & 1) dan mode pengembangan (chain mati).
 *   GEOv2 — subset dari seed efektif (lib/vrf.ts effectiveSeedV2): seed
 *           on-chain + hash blok konfirmasi + jobId + hash konten. Temuan
 *           audit S-04: seed on-chain di BSC praktis konstan, jadi v1 bisa
 *           ditebak sebelum verifikasi. Kontrak TIDAK berubah — ia hanya
 *           menyimpan hash verdict, apa pun versinya.
 */
interface VerdictBase {
  jobId: number;
  brand: string;
  /** Seed VRF dari on-chain (verificationSeed kontrak). */
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

export interface VerdictV1 extends VerdictBase {
  v: 'GEOv1';
}

export interface VerdictV2 extends VerdictBase {
  v: 'GEOv2';
  /** Hash transaksi confirmStructural — bukti blok mana yang dipakai (bisa dicek di explorer). */
  confirmTx: string;
  /** Hash blok tempat confirmTx masuk. */
  confirmBlockHash: string;
  /** Hash konten yang ditandatangani freelancer (deliverableHash on-chain). */
  deliverableHash: string;
}

export type Verdict = VerdictV1 | VerdictV2;

const SEP = '\n';

/**
 * Kanonikalisasi eksplisit — tidak bergantung urutan properti objek.
 * Alasannya sama dengan canonicalQueryPool: JSON.stringify tidak menjamin
 * urutan, jadi tidak bisa dipakai untuk sesuatu yang harus direproduksi
 * pihak lain.
 *
 * v1 TIDAK BOLEH berubah satu karakter pun: hash-nya sudah tersimpan
 * permanen di kontrak (job 0 & 1). v2 = baris v1 + tiga baris di akhir,
 * heksadesimal huruf kecil.
 */
export function canonicalVerdict(v: Verdict): string {
  // brand ikut masuk string kanonik, jadi tunduk pada batasan yang sama.
  assertCanonicalSafe(v.brand, 'Nama brand');

  const base = [
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
  ];
  if (v.v === 'GEOv2') {
    base.push(v.confirmTx.toLowerCase(), v.confirmBlockHash.toLowerCase(), v.deliverableHash.toLowerCase());
  }
  return base.join(SEP);
}

export function verdictHash(v: Verdict): `0x${string}` {
  return keccak256(toHex(canonicalVerdict(v)));
}

/** Seed yang BENAR-BENAR dipakai mengundi subset, sesuai versi verdict. */
export function subsetSeed(v: Verdict): `0x${string}` {
  if (v.v === 'GEOv2') {
    return effectiveSeedV2({ seed: v.seed, confirmBlockHash: v.confirmBlockHash, jobId: v.jobId, deliverableHash: v.deliverableHash });
  }
  return v.seed as `0x${string}`;
}

/**
 * Hitung ulang subset dari isi verdict — SATU tempat, dipakai alur
 * verifikasi, GET /api/jobs/:id/verdict, dan audit di browser.
 */
export function recomputeSubset(v: Verdict): number[] {
  return deriveSubset(subsetSeed(v), v.n, subsetSize(v.n));
}
