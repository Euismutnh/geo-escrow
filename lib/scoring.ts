export type Decision = 'release' | 'refund' | 'dispute';

export interface DecideArgs {
  /** Jumlah pertanyaan di subset yang menyebut brand. */
  score: number;
  /** Ukuran subset yang diuji. */
  of: number;
  /** target_count job (berapa dari total pool yang harus kena). */
  target: number;
  /** Total pertanyaan di pool. */
  n: number;
}

/**
 * Keputusan settlement — aritmetika INTEGER murni.
 *
 * Prototipe memakai float + epsilon:
 *   scaled  = (target / n) * of
 *   release : score >= ceil(scaled - 0.001)
 *   refund  : score <= scaled - 2
 *
 * Epsilon `-0.001` itu tambalan untuk galat pembulatan floating point.
 * Kalikan silang dengan n (selalu positif) dan epsilon tidak dibutuhkan lagi:
 *   release : score * n >= target * of
 *   refund  : score * n <= target * of - 2n
 *
 * Hasilnya identik untuk semua kasus batas, tapi sekarang bisa dihitung
 * ulang oleh pihak lain — termasuk smart contract — tanpa risiko selisih
 * pembulatan. Ini yang membuat verdict bisa diaudit.
 */
export function decide({ score, of, target, n }: DecideArgs): Decision {
  if (n <= 0) {
    throw new Error('decide(): n harus lebih besar dari 0');
  }
  if (score * n >= target * of) return 'release';
  if (score * n <= target * of - 2 * n) return 'refund';
  return 'dispute';
}

/**
 * Target yang diskalakan ke ukuran subset.
 * HANYA untuk ditampilkan ke user — jangan dipakai untuk memutuskan,
 * karena ini float dan bisa berbeda tipis antar-mesin.
 */
export function scaledTarget(target: number, of: number, n: number): number {
  return (target / n) * of;
}
