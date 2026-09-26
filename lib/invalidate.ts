import type { QueryClient } from '@tanstack/react-query';

/**
 * Segarkan semua cache yang bisa berubah setelah sesuatu terjadi di chain
 * atau di Oracle — dipakai <TxButton> (setelah transaksi user) dan tombol
 * aksi Oracle (setelah verifikasi/konfirmasi/baseline). Satu tempat,
 * supaya keduanya tidak melupakan cache yang berbeda.
 */
export function invalidateAfterChange(qc: QueryClient, jobId: number | null): void {
  if (jobId !== null) {
    qc.invalidateQueries({ queryKey: ['job', jobId] });
    qc.invalidateQueries({ queryKey: ['verdict', jobId] });
  }
  for (const k of ['jobs', 'stats', 'activity', 'oracle-log']) qc.invalidateQueries({ queryKey: [k] });
  // Query wagmi: saldo wallet & kontrak, dan pembacaan kontrak (getJob di
  // panel audit, requiredBond). Kunci diperiksa di @wagmi/core/query:
  // ['balance', …] dan ['readContract', …].
  qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'balance' || q.queryKey[0] === 'readContract' });
}
