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

/** Satu hasil engine untuk satu pertanyaan — bentuk minimum baris oracle_runs. */
export interface RunHit {
  query_index: number;
  engine: string;
  hit: boolean;
}

/**
 * Gabungkan hasil per-engine jadi SATU hit per pertanyaan.
 *
 * Aturannya (dipindah dari lib/oracle/runner.ts, sama seperti prototipe):
 *   - pertanyaan dihitung "hit" hanya kalau LOLOS DI SEMUA engine
 *   - pertanyaan yang belum dijawab SEMUA engine TIDAK dimasukkan ke hasil:
 *     "belum diketahui" tidak boleh diperlakukan sebagai "tidak disebut"
 *   - baris dari engine di luar `engineIds` DIABAIKAN (mis. sisa dari
 *     provider lain di job yang sama)
 *
 * Fungsi murni — dipakai runner (server) DAN radar sitasi (frontend), supaya
 * angka yang dilihat juri di radar tidak bisa berbeda dari skor verdict.
 * Kalau satu engine punya dua baris untuk pertanyaan yang sama, yang
 * terakhir di `runs` yang dipakai.
 */
export function hitPerQuery(
  runs: readonly RunHit[],
  engineIds: readonly string[]
): Map<number, boolean> {
  if (engineIds.length === 0) {
    throw new Error('hitPerQuery(): engineIds tidak boleh kosong');
  }
  const wanted = new Set(engineIds);
  const perQuery = new Map<number, Map<string, boolean>>();
  for (const r of runs) {
    if (!wanted.has(r.engine)) continue;
    let m = perQuery.get(r.query_index);
    if (!m) perQuery.set(r.query_index, (m = new Map()));
    m.set(r.engine, r.hit);
  }

  const out = new Map<number, boolean>();
  for (const [index, m] of perQuery) {
    if (m.size !== wanted.size) continue; // belum lengkap = belum diketahui
    out.set(index, [...m.values()].every(Boolean));
  }
  return out;
}

/**
 * Target yang diskalakan ke ukuran subset.
 * HANYA untuk ditampilkan ke user — jangan dipakai untuk memutuskan,
 * karena ini float dan bisa berbeda tipis antar-mesin.
 */
export function scaledTarget(target: number, of: number, n: number): number {
  return (target / n) * of;
}
