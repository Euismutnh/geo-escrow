import { env } from './env';

/**
 * Jembatan ke smart contract.
 *
 * STATUS: baru jalur CHAIN_ENABLED=false yang lengkap. Jalur on-chain
 * sesungguhnya diisi di Fase 9, setelah tim blockchain menyerahkan ABI
 * dan alamat kontrak.
 *
 * Dengan CHAIN_ENABLED=false, readJobFromChain() mengembalikan null dan
 * pemanggilnya MELEWATI verifikasi hash. Itu memang yang membuat Fase
 * 0-8 bisa dibangun tanpa menunggu kontrak -- tapi juga berarti gerbang
 * keaslian data sedang MATI. Lihat catatan keamanan di app/api/jobs.
 */

export interface OnChainJob {
  client: string;
  freelancer: string;
  queryPoolHash: string;
  deliverableHash: string;
  verdictHash: string;
  verificationSeed: string;
  budget: bigint;
  bond: bigint;
  structuralReleased: bigint;
  status: number;
  acceptDeadline: bigint;
}

/** Penanda bahwa sebuah jalur on-chain belum diimplementasi. */
function notYet(fn: string): never {
  throw new Error(
    `${fn}() belum diimplementasi. Butuh ABI + alamat kontrak dari tim ` +
      `blockchain (Fase 9). Sementara ini jalankan dengan CHAIN_ENABLED=false.`
  );
}

/**
 * Baca satu job dari blockchain.
 *
 * Mengembalikan null kalau CHAIN_ENABLED=false -- pemanggil harus
 * memperlakukan null sebagai "verifikasi dilewati", BUKAN "job tidak ada".
 */
export async function readJobFromChain(jobId: bigint): Promise<OnChainJob | null> {
  if (!env.chainEnabled) return null;
  void jobId;
  notYet('readJobFromChain');
}

export async function getVerificationSeed(jobId: bigint): Promise<`0x${string}`> {
  if (!env.chainEnabled) {
    // Seed deterministik untuk pengembangan, supaya Fase 8 bisa diuji
    // tanpa kontrak. TIDAK boleh dipakai di produksi -- bisa ditebak.
    const { keccak256, toHex } = await import('viem');
    return keccak256(toHex(`dev-seed-${jobId}`));
  }
  notYet('getVerificationSeed');
}

export async function confirmStructuralOnChain(jobId: bigint): Promise<{ hash: string }> {
  if (!env.chainEnabled) return { hash: '0xdev' };
  void jobId;
  notYet('confirmStructuralOnChain');
}

export async function settleOnChain(
  jobId: bigint,
  decision: 'release' | 'refund' | 'dispute',
  verdictHash: `0x${string}`
): Promise<{ hash: string }> {
  if (!env.chainEnabled) return { hash: '0xdev' };
  void jobId;
  void decision;
  void verdictHash;
  notYet('settleOnChain');
}
