import type { ContractFunctionArgs } from 'viem';
import type { geoEscrowAbi } from './abi';
import type { Job } from './types';

/*
 * Logika MURNI siklus transaksi (<TxButton>) dan peran wallet — tanpa
 * React dan tanpa wagmi, supaya setiap cabangnya diuji di
 * scripts/check-pure.ts (blueprint §A13).
 */

// ---------------------------------------------------------------------
// Fungsi kontrak yang BOLEH dipanggil dari browser
// ---------------------------------------------------------------------

/**
 * Enam fungsi milik pengguna + SATU fungsi owner. Fungsi Oracle
 * (confirmStructural, settleRelease, …) dan owner lainnya (setOracle,
 * setVerifyTimeout, transferOwnership, renounceOwnership) sengaja TIDAK
 * ada di sini: FE tidak perlu menawarkan tombol yang pasti revert atau yang
 * berbahaya. Tipe ini membuat salah panggil ditolak compiler.
 *
 * `setArbiter` ada karena arbiter hasil deploy (0xd1ff…) kuncinya tidak
 * diketahui siapa pun — tanpa menggantinya, job Disputed terkunci selamanya.
 * Owner menandatanganinya di wallet-nya sendiri, jadi private key owner
 * tidak pernah perlu diekspor (lebih aman dari skrip seperti set-oracle.ts).
 * Tombolnya hanya tampil untuk wallet owner (components/admin/ArbiterAdmin).
 */
export type UserWriteFn =
  | 'createJob'
  | 'acceptJob'
  | 'submitDeliverable'
  | 'arbiterDecide'
  | 'reclaimExpired'
  | 'escalateStuckJob'
  | 'setArbiter';

export type TxCall<F extends UserWriteFn = UserWriteFn> = {
  functionName: F;
  args: ContractFunctionArgs<typeof geoEscrowAbi, 'payable' | 'nonpayable', F>;
  /** wei, BigInt. Untuk acceptJob WAJIB persis requiredBond(jobId) (§A10). */
  value?: bigint;
};

// ---------------------------------------------------------------------
// Siklus hidup
// ---------------------------------------------------------------------

/**
 *   check → sign → confirm → (after) → sync → done
 *
 * Terminal selain done:
 *   rejected     user menolak di wallet — BUKAN error (jangan merah)
 *   blocked      simulasi menunjukkan kontrak akan menolak; tidak ada yang terkirim
 *   reverted     masuk blok tapi revert; gas terpakai, dana tidak berpindah
 *   failed       gagal sebelum/ saat mengirim (saldo, jaringan, akun berubah, …)
 *   unknown      terkirim, receipt belum datang sampai batas waktu — JANGAN kirim ulang
 *   sync_failed  tx SUKSES, tapi server belum sempat membaca ulang
 */
export type TxPhase =
  | 'idle' | 'check' | 'sign' | 'confirm' | 'after' | 'sync' | 'done'
  | 'rejected' | 'blocked' | 'reverted' | 'failed' | 'unknown' | 'sync_failed';

export interface TxState {
  phase: TxPhase;
  hash?: `0x${string}`;
  message?: string;
}

export const BUSY_PHASES: readonly TxPhase[] = ['check', 'sign', 'confirm', 'after', 'sync'];
export const isBusy = (p: TxPhase) => BUSY_PHASES.includes(p);

/** Label tombol selama sibuk. */
export const BUSY_LABEL: Partial<Record<TxPhase, string>> = {
  check: 'Memeriksa…',
  sign: 'Setujui di wallet…',
  confirm: 'Menunggu konfirmasi…',
  after: 'Menyimpan…',
  sync: 'Menyinkronkan…',
};

/** Empat langkah yang digambar di bawah tombol (mockup txSteps). */
export const TX_STEPS = ['Tanda tangan', 'Terkirim', 'Terkonfirmasi', 'Sinkron'] as const;

/** Indeks langkah aktif; langkah sebelumnya dianggap selesai. */
export function stepIndex(p: TxPhase): number {
  switch (p) {
    case 'check': case 'sign': return 0;
    case 'confirm': return 2; // hash sudah ada = "Terkirim" selesai
    case 'after': case 'sync': return 3;
    case 'done': return 4;
    default: return -1;
  }
}

// ---------------------------------------------------------------------
// Klasifikasi error
// ---------------------------------------------------------------------

type ErrLike = { name?: unknown; code?: unknown; cause?: unknown; shortMessage?: unknown; reason?: unknown; data?: unknown; message?: unknown };

/** Rantai `cause` — viem & wagmi sama-sama membungkus error aslinya berlapis. */
function chain(e: unknown): ErrLike[] {
  const out: ErrLike[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 12 && cur && typeof cur === 'object'; i++) {
    out.push(cur as ErrLike);
    cur = (cur as ErrLike).cause;
  }
  return out;
}

const hasName = (c: ErrLike[], ...names: string[]) => c.some((x) => typeof x.name === 'string' && names.includes(x.name));

/**
 * Pesan yang aman & manusiawi. TIDAK PERNAH `e.message` mentah: pesan
 * viem memuat URL RPC dan isi request (temuan A21). `shortMessage` viem
 * adalah ringkasan satu baris tanpa detail itu.
 */
function short(c: ErrLike[]): string {
  for (const x of c) if (typeof x.shortMessage === 'string' && x.shortMessage) return x.shortMessage.slice(0, 160);
  return 'Kesalahan tak terduga';
}

function revertReason(c: ErrLike[]): string | null {
  for (const x of c) {
    if (x.name !== 'ContractFunctionRevertedError') continue;
    // Tanpa ABI error yang cocok, viem mengisi reason dari pesan node —
    // lengkap dengan awalan 'execution reverted:'. Yang ditampilkan: alasannya saja.
    if (typeof x.reason === 'string' && x.reason) return x.reason.replace(/^execution reverted:?\s*/i, '') || null;
    const d = x.data as { errorName?: unknown } | undefined;
    if (d && typeof d.errorName === 'string') return d.errorName;
  }
  return null;
}

export function isUserRejection(e: unknown): boolean {
  const c = chain(e);
  return hasName(c, 'UserRejectedRequestError') || c.some((x) => x.code === 4001 || x.code === 'ACTION_REJECTED');
}

export const TX_MSG = {
  rejected: 'Dibatalkan di wallet. Tidak ada yang terkirim, tidak ada gas terpakai.',
  reverted: 'Transaksi masuk blok tapi ditolak kontrak (revert). Dana tidak berpindah; biaya gas tetap terpakai.',
  funds: 'Saldo tBNB di wallet tidak cukup untuk nilai transaksi ditambah gas.',
  chain: 'Wallet tidak berada di BNB Smart Chain Testnet. Pindah jaringan lalu coba lagi.',
  account: 'Akun di wallet berubah di tengah proses. Tidak ada yang terkirim — coba lagi dengan akun yang benar.',
} as const;

export function unknownMessage(seconds: number): string {
  return `Belum terkonfirmasi setelah ${seconds} detik. Transaksinya mungkin masih diproses — periksa di BscScan sebelum mencoba lagi, supaya tidak terkirim dua kali.`;
}

/**
 * Error → keadaan akhir. `stage` menentukan artinya: revert saat SIMULASI
 * berarti tidak ada yang terkirim (blocked); error saat menunggu receipt
 * berarti tx SUDAH terkirim dan nasibnya belum diketahui (unknown).
 */
export function classifyTxError(e: unknown, stage: 'simulate' | 'write' | 'receipt', timeoutSec = 120): TxState {
  const c = chain(e);
  if (isUserRejection(e)) return { phase: 'rejected', message: TX_MSG.rejected };
  if (hasName(c, 'InsufficientFundsError')) return { phase: 'failed', message: TX_MSG.funds };
  if (hasName(c, 'ChainMismatchError', 'ConnectorChainMismatchError')) return { phase: 'failed', message: TX_MSG.chain };
  if (hasName(c, 'ConnectorAccountNotFoundError', 'ConnectorUnavailableReconnectingError')) return { phase: 'failed', message: TX_MSG.account };

  if (stage === 'receipt') {
    // Hash sudah ada. Apa pun errornya, tx mungkin tetap masuk blok.
    return { phase: 'unknown', message: unknownMessage(timeoutSec) };
  }
  const reason = revertReason(c);
  if (stage === 'simulate' && (reason || hasName(c, 'ContractFunctionRevertedError'))) {
    return {
      phase: 'blocked',
      message: `Kontrak akan menolak transaksi ini${reason ? `: “${reason}”` : ''}. Tidak ada yang dikirim, tidak ada gas terpakai.`,
    };
  }
  return { phase: 'failed', message: `Transaksi gagal: ${short(c)}` };
}

// ---------------------------------------------------------------------
// Sinkronisasi setelah receipt — POST /api/sync/:id
// ---------------------------------------------------------------------

/** Kode error dari server → apa yang dilakukan <TxButton>. */
export function syncDecision(code: string | undefined, attempt: number): 'retry' | 'give_up' {
  // Server membatasi 1 sync per job per 2 detik; satu alur normal bisa
  // menabraknya. Ulangi SEKALI — lebih dari itu cron yang akan memungutnya.
  return code === 'RATE_LIMITED' && attempt === 0 ? 'retry' : 'give_up';
}

export const SYNC_FAILED_MSG =
  'Transaksi berhasil dan dana sudah berpindah di blockchain. Tampilan belum diperbarui — server akan membacanya pada sinkronisasi berikutnya.';

// ---------------------------------------------------------------------
// Konektor wallet (modal "Hubungkan wallet")
// ---------------------------------------------------------------------

/** Id konektor cadangan injected() polos. Konektor EIP-6963 ber-id rdns-nya. */
export const GENERIC_INJECTED_ID = 'injected';

/**
 * Konektor yang ditampilkan di modal: semua wallet EIP-6963; konektor
 * cadangan HANYA kalau tidak ada satu pun, dan memang ada provider di
 * halaman. Tanpa aturan ini MetaMask tampil dua kali ("MetaMask" dan
 * "Injected") — dan yang diklik belum tentu yang terbuka.
 */
export function pickConnectors<C extends { id: string; type: string }>(all: readonly C[], hasWindowProvider: boolean): C[] {
  const announced = all.filter((c) => c.type === 'injected' && c.id !== GENERIC_INJECTED_ID);
  if (announced.length > 0) return announced;
  return hasWindowProvider ? all.filter((c) => c.id === GENERIC_INJECTED_ID) : [];
}

// ---------------------------------------------------------------------
// Peran wallet terhadap sebuah kontrak
// ---------------------------------------------------------------------

/**
 * Tanpa membedakan huruf: database menyimpan alamat huruf kecil, wallet
 * dan kontrak memberi checksum (huruf campuran). `===` biasa selalu gagal.
 */
export function sameAddr(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.toLowerCase() === b.toLowerCase();
}

export type Relation = 'client' | 'freelancer' | 'arbiter' | null;

/**
 * Peran wallet aktif di SATU kontrak. Kalau satu alamat kebetulan client
 * DAN freelancer, yang ditampilkan client (sumber kontrak tidak ada di
 * repo, jadi kemungkinan itu tidak diasumsikan mustahil). Arbiter adalah
 * peran tingkat-kontrak, bukan per-job, dan hanya berlaku kalau alamatnya
 * bukan pihak di kontrak itu.
 */
export function relationToJob(
  job: Pick<Job, 'client_addr' | 'freelancer_addr'>,
  wallet: string | null | undefined,
  arbiter?: string | null
): Relation {
  if (!wallet) return null;
  if (sameAddr(job.client_addr, wallet)) return 'client';
  if (sameAddr(job.freelancer_addr, wallet)) return 'freelancer';
  if (sameAddr(arbiter, wallet)) return 'arbiter';
  return null;
}

export const RELATION_LABEL: Record<Exclude<Relation, null>, string> = {
  client: 'Client',
  freelancer: 'Freelancer',
  arbiter: 'Arbiter',
};

/** Nama jaringan yang umum, untuk banner "jaringan salah". Sisanya: chain ID-nya. */
const KNOWN_CHAINS: Record<number, string> = {
  1: 'Ethereum Mainnet',
  56: 'BNB Smart Chain Mainnet',
  137: 'Polygon',
  8453: 'Base',
  42161: 'Arbitrum One',
  10: 'OP Mainnet',
  11155111: 'Sepolia',
};
export function chainName(id: number | undefined): string {
  if (id === undefined) return 'jaringan lain';
  return KNOWN_CHAINS[id] ?? `jaringan dengan chain ID ${id}`;
}
