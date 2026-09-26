import type { ActivityEntry, Job } from './types';

/**
 * Saldo escrow dihitung dari LEDGER AKTIVITAS (cermin event on-chain yang
 * ditulis indexer), bukan dari tabel jobs.
 *
 * Alasannya diuji terhadap data sungguhan (2026-09-24): job yang dibuat
 * saat CHAIN_ENABLED=false ada di tabel jobs tapi TIDAK ada di blockchain.
 * Menjumlah dari tabel jobs melebih-lebihkan dana yang terkunci; ledger
 * tidak. Untuk setiap job yang tercatat, keduanya cocok sampai ke wei.
 *
 * Arah uang per tipe, sesuai GeoEscrow._settle():
 *   - Settled.amount   = SISA budget + BOND, satu transfer (final_* / jury_*)
 *   - BondSettled      = bond yang SAMA, dipancarkan sebagai rincian
 *                        (bond_return / bond_slash)
 * jadi BondSettled NETRAL. Dulu keduanya dihitung keluar — anggapan bahwa
 * Settled hanya membawa sisa budget — dan setiap job yang settle membuat
 * saldo minus sebesar bond-nya. Diperiksa ulang ke kontrak 26-09-2026:
 * `_payout(recipient, remainder + bond)` lalu dua event.
 *
 * Tiga daftar ini WAJIB mencakup setiap tipe di union ActivityType milik
 * lib/indexer.ts — scripts/check-pure.ts membaca union itu dan gagal kalau
 * ada tipe yang tidak terklasifikasi.
 */
export const LEDGER_IN = ['deposit', 'bond_lock'] as const;
export const LEDGER_OUT = [
  'structural_release',
  'final_release',
  'final_refund',
  'jury_release',
  'jury_refund',
  'reclaim',
] as const;
/** Tipe tanpa perpindahan uang SENDIRI (bond_* sudah termasuk di Settled). */
export const LEDGER_NEUTRAL = ['structural_rejected', 'dispute_raised', 'vrf_pick', 'bond_return', 'bond_slash'] as const;

const IN = new Set<string>(LEDGER_IN);
const OUT = new Set<string>(LEDGER_OUT);
const NEUTRAL = new Set<string>(LEDGER_NEUTRAL);

export type LedgerRow = Pick<ActivityEntry, 'type' | 'amount_wei' | 'created_at'>;

export interface LedgerResult {
  balance: bigint;
  /**
   * Baris yang tidak bisa dihitung dengan yakin: tipe yang tidak dikenal,
   * atau tipe berpindah-uang tanpa jumlah. Kalau tidak kosong, saldo
   * TIDAK BOLEH ditampilkan sebagai angka pasti.
   */
  problems: string[];
}

/** Saldo pada waktu `at` (ms). Tanpa `at`: semua baris. */
export function ledgerBalance(rows: readonly LedgerRow[], at?: number): LedgerResult {
  let balance = 0n;
  const problems: string[] = [];
  for (const r of rows) {
    if (at !== undefined && Date.parse(r.created_at) > at) continue;
    const isIn = IN.has(r.type), isOut = OUT.has(r.type);
    if (!isIn && !isOut) {
      if (!NEUTRAL.has(r.type)) problems.push(`tipe tidak dikenal: ${r.type}`);
      continue;
    }
    if (r.amount_wei == null) { problems.push(`${r.type} tanpa jumlah`); continue; }
    const v = BigInt(r.amount_wei);
    balance += isIn ? v : -v;
  }
  return { balance, problems };
}

const lc = (a: string | null | undefined) => (a ? a.toLowerCase() : '');
const OPEN_STATUSES = new Set<Job['status']>(['Open', 'Accepted', 'Submitted', 'Verifying', 'Disputed']);

/**
 * Dana ATAS NAMA satu wallet yang masih di kontrak, dari kolom jobs yang
 * ditulis indexer (budget_wei, structural_released_wei, bond_wei) — tidak
 * ada persentase yang dihitung di FE (§A10).
 *   client     : budget − yang sudah cair struktural
 *   freelancer : bond
 * Hanya job yang belum settle. Alamat dibandingkan tanpa huruf besar/kecil.
 */
export function lockedFor(jobs: readonly Pick<Job, 'status' | 'client_addr' | 'freelancer_addr' | 'budget_wei' | 'structural_released_wei' | 'bond_wei'>[], wallet: string): bigint {
  const w = lc(wallet);
  let sum = 0n;
  for (const j of jobs) {
    if (!OPEN_STATUSES.has(j.status)) continue;
    if (lc(j.client_addr) === w) sum += BigInt(j.budget_wei) - BigInt(j.structural_released_wei);
    else if (lc(j.freelancer_addr) === w && j.bond_wei) sum += BigInt(j.bond_wei);
  }
  return sum;
}

/** Total yang pernah DITERIMA wallet dari kontrak (baris OUT yang to_addr-nya wallet itu). */
export function receivedBy(rows: readonly Pick<ActivityEntry, 'type' | 'amount_wei' | 'to_addr'>[], wallet: string): bigint {
  const w = lc(wallet);
  let sum = 0n;
  for (const r of rows) if (OUT.has(r.type) && r.amount_wei != null && lc(r.to_addr) === w) sum += BigInt(r.amount_wei);
  return sum;
}

/** Saldo di `points` titik yang merata antara `from` dan `to` (ms) — untuk grafik tren. */
export function ledgerSeries(rows: readonly LedgerRow[], from: number, to: number, points: number): bigint[] {
  if (points < 2) throw new Error('ledgerSeries(): points minimal 2');
  const out: bigint[] = [];
  for (let i = 0; i < points; i++) out.push(ledgerBalance(rows, from + ((to - from) * i) / (points - 1)).balance);
  return out;
}
