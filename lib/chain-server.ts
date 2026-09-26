import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { env } from './env';
import { ApiError } from './http';
import { geoEscrowAbi, STATUS_BY_INDEX } from './abi';

/**
 * Jembatan ke smart contract.
 *
 * Dengan CHAIN_ENABLED=false, readJobFromChain() mengembalikan null dan
 * pemanggilnya MELEWATI verifikasi hash. Itu yang membuat Fase 0-8 bisa
 * dibangun tanpa menunggu kontrak -- tapi juga berarti gerbang keaslian
 * data sedang MATI. Lihat catatan keamanan di app/api/jobs/route.ts.
 *
 * Jalur BACA tidak butuh private key sama sekali (eth_call itu gratis
 * dan tanpa tanda tangan). Jalur TULIS butuh ORACLE_PRIVATE_KEY.
 */

let _pub: ReturnType<typeof createPublicClient> | null = null;

/** Klien baca. Tidak butuh private key. */
export function publicClient() {
  _pub ??= createPublicClient({ chain: bscTestnet, transport: http(env.rpcUrl) });
  return _pub;
}

export function escrowAddress(): Address {
  return env.escrowAddress as Address;
}

/**
 * 11 field `getJob()` + `submittedAt`. Dibaca dari getter publik `jobs()`
 * yang memuat seluruh struct — `getJob()` tidak menyertakan `submittedAt`,
 * padahal hanya itu patokan waktu yang dipakai `escalateStuckJob`.
 */
export interface OnChainJob {
  client: string;
  freelancer: string;
  queryPoolHash: string;
  deliverableHash: string;
  verdictHash: string;
  /** Diisi kontrak saat confirmStructural. Nol = belum dikonfirmasi. */
  verificationSeed: string;
  budget: bigint;
  bond: bigint;
  structuralReleased: bigint;
  /** uint8 — indeksnya ke STATUS_BY_INDEX. */
  status: number;
  /** Unix DETIK, bukan nomor blok: kontrak membandingkannya dengan block.timestamp. */
  acceptDeadline: bigint;
  /** Unix detik saat submitDeliverable. 0 = belum/di-reset rejectStructural. */
  submittedAt: bigint;
}

/** Hasil satu transaksi oracle. */
export interface TxResult {
  /**
   * Hash transaksi, ATAU salah satu sentinel di bawah kalau tidak ada
   * transaksi yang dikirim. Jangan tampilkan ini sebagai tautan explorer
   * tanpa memeriksa `alreadyDone` dan awalan `0x` yang 66 karakter.
   */
  hash: string;
  /**
   * true = tidak ada transaksi yang dikirim karena kontrak SUDAH berada
   * di status tujuan. Bukan kegagalan — justru pengaman terhadap
   * pembayaran ganda. Lihat `sudahLewat()`.
   */
  alreadyDone: boolean;
}

/** Tidak ada chain sama sekali (CHAIN_ENABLED=false). */
const HASH_DEV = '0xdev';

/**
 * Chain menyala, tapi kontrak sudah di status tujuan — jadi tidak ada
 * yang perlu dikirim.
 *
 * Sengaja DIBEDAKAN dari HASH_DEV. Keduanya berarti "tidak ada transaksi",
 * tapi sebabnya berbeda jauh: yang satu mode pengembangan, yang satu lagi
 * bukti bahwa uangnya SUDAH berpindah di percobaan sebelumnya. Kalau
 * disamakan, log produksi akan penuh '0xdev' dan tidak ada yang sadar
 * settlement-nya sebenarnya sudah terjadi.
 */
const HASH_SUDAH = '0xsudah';

// ══════════════════════════════════════════════════════════════════
// JALUR BACA
// ══════════════════════════════════════════════════════════════════

/**
 * Baca satu job dari blockchain.
 *
 * `null` punya DUA arti dan pemanggil WAJIB membedakannya lewat
 * `env.chainEnabled`:
 *
 *   chain mati   -> "verifikasi sengaja dilewati"
 *   chain nyala  -> "job memang belum ada di kontrak"
 *
 * Yang TIDAK pernah menghasilkan null: RPC putus, alamat kontrak salah,
 * jaringan bermasalah. Itu semua dibiarkan melempar.
 *
 * Kenapa penting: POST /api/jobs membaca null sebagai "kirim transaksi
 * dulu". Kalau error RPC ikut jadi null, user yang transaksinya sudah
 * berhasil akan disuruh mengirim ulang — dan membayar gas dua kali.
 */
export async function readJobFromChain(jobId: bigint): Promise<OnChainJob | null> {
  if (!env.chainEnabled) return null;

  const total = (await publicClient().readContract({
    address: escrowAddress(),
    abi: geoEscrowAbi,
    functionName: 'jobCount',
  })) as bigint;

  // Di luar jangkauan = benar-benar belum ada. Ini SATU-SATUNYA alasan
  // sah mengembalikan null saat chain menyala.
  //
  // jobId pertama adalah 0 (kontrak memakai jobCount++), jadi job yang
  // sah berada di [0, total). Perbandingannya >= , bukan > .
  if (jobId < 0n || jobId >= total) return null;

  // Getter mapping publik mengembalikan TUPLE (urutan field struct Job di
  // GeoEscrow.sol), bukan objek bernama seperti getJob().
  const [
    client, freelancer, queryPoolHash, deliverableHash, verdictHash, verificationSeed,
    budget, bond, structuralReleased, acceptDeadline, submittedAt, status,
  ] = await publicClient().readContract({
    address: escrowAddress(),
    abi: geoEscrowAbi,
    functionName: 'jobs',
    args: [jobId],
  });

  return {
    client, freelancer, queryPoolHash, deliverableHash, verdictHash, verificationSeed,
    budget, bond, structuralReleased, status: Number(status), acceptDeadline, submittedAt,
  };
}

/**
 * Seed VRF untuk memilih subset pertanyaan.
 *
 * Kontrak yang mengundinya saat confirmStructural, dan nilainya publik —
 * itulah yang membuat pemilihan subset bisa diaudit siapa pun. Oracle
 * tidak bisa mengundi ulang sampai dapat subset yang menguntungkan.
 */
export async function getVerificationSeed(jobId: bigint): Promise<Hex> {
  if (!env.chainEnabled) {
    // Seed deterministik untuk pengembangan, supaya Fase 8 bisa diuji
    // tanpa kontrak. TIDAK boleh dipakai di produksi — bisa ditebak.
    const { keccak256, toHex } = await import('viem');
    return keccak256(toHex(`dev-seed-${jobId}`));
  }

  const seed = (await publicClient().readContract({
    address: escrowAddress(),
    abi: geoEscrowAbi,
    functionName: 'verificationSeed',
    args: [jobId],
  })) as Hex;

  // Nol berarti confirmStructural belum pernah jalan. Membiarkannya
  // lewat akan menghasilkan subset yang SAMA untuk setiap job dan bisa
  // dihitung siapa pun sebelum verifikasi — freelancer tinggal
  // mengoptimalkan konten untuk pertanyaan yang sudah ia tahu terpilih.
  if (/^0x0*$/.test(seed)) {
    throw new Error(
      `verificationSeed job ${jobId} masih nol — confirmStructural belum ` +
        `dijalankan di kontrak. Jangan verifikasi sebelum seed terisi.`
    );
  }

  return seed;
}

/**
 * Bond yang harus dikirim freelancer saat acceptJob.
 *
 * FE membaca ini SEBELUM membentuk transaksi. Menghitungnya sendiri dari
 * budget × BOND_BPS berisiko meleset karena pembulatan integer, dan
 * `acceptJob` menolak nilai yang tidak persis.
 *
 * Melempar untuk job yang belum ada. Terbukti perlu: kontrak TIDAK
 * revert untuk jobId di luar jangkauan — ia membaca struct kosong dan
 * mengembalikan **0**. Kalau angka itu diteruskan ke FE, tombol "Ambil
 * kontrak" akan mengirim `acceptJob` dengan value 0, dan freelancer
 * membayar gas untuk transaksi yang pasti gagal.
 */
export async function readRequiredBond(jobId: bigint): Promise<bigint> {
  const total = (await publicClient().readContract({
    address: escrowAddress(),
    abi: geoEscrowAbi,
    functionName: 'jobCount',
  })) as bigint;

  if (jobId < 0n || jobId >= total) {
    throw new Error(
      `Job ${jobId} belum ada di kontrak (jobCount = ${total}). ` +
        `requiredBond untuknya akan 0, bukan nilai yang sah.`
    );
  }

  return (await publicClient().readContract({
    address: escrowAddress(),
    abi: geoEscrowAbi,
    functionName: 'requiredBond',
    args: [jobId],
  })) as bigint;
}

// ══════════════════════════════════════════════════════════════════
// JALUR TULIS
// ══════════════════════════════════════════════════════════════════

let _wallet: ReturnType<typeof createWalletClient> | null = null;

/**
 * Klien tulis, memakai wallet oracle.
 *
 * Kuncinya dibaca dari env dan TIDAK PERNAH masuk log, pesan error, atau
 * respons API — pesan di bawah sengaja hanya menyebut panjang/bentuk
 * yang salah, bukan isinya.
 */
function walletClient() {
  if (_wallet) return _wallet;

  const raw = env.oraclePrivateKey.trim();
  const key = (raw.startsWith('0x') ? raw : `0x${raw}`) as Hex;

  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      'ORACLE_PRIVATE_KEY bukan private key yang sah: harus 64 karakter ' +
        'heksadesimal (boleh dengan atau tanpa awalan 0x). Periksa apakah ' +
        'yang tersalin itu ALAMAT wallet (42 karakter) dan bukan kuncinya.'
    );
  }

  _wallet = createWalletClient({
    account: privateKeyToAccount(key),
    chain: bscTestnet,
    transport: http(env.rpcUrl),
  });
  return _wallet;
}

let _cekOracle: Promise<void> | null = null;

/**
 * Pastikan wallet yang memegang kunci memang oracle-nya kontrak.
 *
 * Tanpa ini, kunci yang salah membuat SETIAP transaksi revert dengan
 * pesan mentah dari EVM ("execution reverted") — yang tidak memberi
 * petunjuk apa pun. Padahal penyebabnya cuma satu baris di .env.local.
 *
 * Dicek sekali per proses, hasilnya di-cache sebagai promise supaya
 * pemanggilan bersamaan tidak menembak RPC berkali-kali.
 */
function assertOracleWallet(): Promise<void> {
  _cekOracle ??= (async () => {
    const punyaKita = walletClient().account!.address.toLowerCase();
    const onChain = (
      (await publicClient().readContract({
        address: escrowAddress(),
        abi: geoEscrowAbi,
        functionName: 'oracle',
      })) as string
    ).toLowerCase();

    if (punyaKita !== onChain) {
      throw new Error(
        `Wallet dari ORACLE_PRIVATE_KEY (${punyaKita}) BUKAN oracle kontrak ` +
          `(${onChain}). Semua transaksi oracle akan ditolak. Perbaiki ` +
          `kuncinya, atau minta owner memanggil setOracle(${punyaKita}).`
      );
    }
  })().catch((e) => {
    _cekOracle = null; // biar percobaan berikutnya mencoba lagi
    throw e;
  });

  return _cekOracle;
}

/**
 * Antrean transaksi — SATU transaksi oracle pada satu waktu.
 *
 * Wallet oracle cuma satu, dan nonce-nya berurutan. Dua job yang
 * di-settle bersamaan akan mengambil nonce yang sama dari RPC, lalu
 * salah satunya ditolak "nonce too low" — padahal keduanya sah. Lock
 * per-job di jobs-repo tidak menolong: yang bentrok itu WALLET-nya,
 * bukan job-nya.
 */
let antrean: Promise<unknown> = Promise.resolve();

/**
 * Batas menunggu receipt transaksi Oracle.
 *
 * BSC Testnet ~0,45 detik per blok (diukur 23 Sep 2026); receipt normalnya
 * datang dalam 1–3 detik. Dulu 90 detik — MELEBIHI maxDuration route
 * (sync 30, verify 60), jadi yang terjadi saat jaringan lambat bukan error
 * kita, melainkan proses dipotong platform dengan lock masih terpegang.
 * 30 detik + kerja sebelumnya tetap di bawah maxDuration 60 route yang
 * mengirim tx (sync, verify, indexer/poll).
 */
export const RECEIPT_TIMEOUT_MS = 30_000;

function antre<T>(fn: () => Promise<T>): Promise<T> {
  const hasil = antrean.then(fn, fn);
  // Rantainya tidak boleh putus kalau satu transaksi gagal.
  antrean = hasil.catch(() => undefined);
  return hasil;
}

/** Nama status yang bisa dibaca manusia, untuk pesan error. */
function namaStatus(i: number): string {
  return STATUS_BY_INDEX[i] ?? `tidak dikenal (${i})`;
}

/**
 * Apakah kontrak sudah melewati titik ini?
 *
 * Inilah pengaman terhadap pembayaran ganda. Skenarionya nyata: transaksi
 * settle terkirim, tapi jawaban receipt-nya hilang (timeout, RPC putus).
 * Backend menandai job 'error', lalu percobaan berikutnya memanggil
 * settleOnChain lagi — padahal dana SUDAH pindah.
 *
 * Yang menentukan bukan catatan kita, tapi status di kontrak.
 */
async function sudahLewat(jobId: bigint, tujuan: readonly number[]): Promise<boolean> {
  const job = await readJobFromChain(jobId);
  if (!job) return false;
  return tujuan.includes(Number(job.status));
}

/**
 * Kirim satu transaksi oracle: simulasi -> tulis -> tunggu receipt.
 *
 * Simulasi dulu, selalu. `simulateContract` menjalankan fungsinya di node
 * tanpa mengirim apa pun, jadi revert ketahuan SEBELUM gas terbayar —
 * dan pesannya menyebut alasan revert, bukan cuma "transaction failed".
 *
 * Receipt juga wajib diperiksa: viem TIDAK melempar untuk transaksi yang
 * masuk blok tapi revert. Tanpa baris itu, settle yang gagal akan
 * dilaporkan sukses ke pemanggil.
 */
async function kirim(
  label: string,
  jobId: bigint,
  simulasi: () => Promise<{ request: unknown }>
): Promise<TxResult> {
  await assertOracleWallet();

  return antre(async () => {
    let request: unknown;
    try {
      ({ request } = await simulasi());
    } catch (e) {
      // Revert saat simulasi hampir selalu berarti status kontrak tidak
      // seperti yang kita kira. Sebutkan statusnya — tanpa itu pesannya
      // cuma "execution reverted", yang tidak menunjuk ke mana pun.
      const job = await readJobFromChain(jobId).catch(() => null);
      const status = job ? namaStatus(Number(job.status)) : 'tidak terbaca';
      // Pesan viem memuat URL RPC LENGKAP (dengan kuncinya, kalau penyedia RPC
      // menaruh kunci di URL) dan isi request —
      // jangan disisipkan ke pesan yang bisa berakhir di last_error publik.
      console.error(`[chain] ${label}(job ${jobId}) ditolak kontrak:`, e);
      throw new ApiError(
        'CHAIN_FAILED',
        `${label}(job ${jobId}) ditolak kontrak. Status on-chain saat ini: ${status}.`,
        { cause: e }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hash = await walletClient().writeContract(request as any);
    // Dicatat SEBELUM menunggu receipt: kalau proses dipotong di tengah
    // penantian, hanya baris ini yang tersisa untuk menelusuri tx-nya.
    console.log(`[chain] ${label}(job ${jobId}) terkirim: ${hash}`);

    let receipt;
    try {
      receipt = await publicClient().waitForTransactionReceipt({
        hash,
        confirmations: 1,
        timeout: RECEIPT_TIMEOUT_MS,
      });
    } catch (e) {
      console.error(`[chain] ${label}(job ${jobId}) receipt ${hash} tidak didapat:`, e);
      // Tx mungkin tetap masuk blok. Aman diulang: percobaan berikutnya
      // membaca status kontrak dulu (sudahLewat) sebelum mengirim apa pun.
      throw new ApiError(
        'CHAIN_FAILED',
        `${label} terkirim (tx ${hash}) tapi belum terkonfirmasi dalam ${RECEIPT_TIMEOUT_MS / 1000} detik. ` +
          `Percobaan berikutnya memeriksa status kontrak dulu — tidak ada pembayaran ganda.`,
        { cause: e }
      );
    }

    if (receipt.status !== 'success') {
      // Pesan buatan kita, dan hash tx memang publik di chain — aman
      // diteruskan ke last_error supaya UI bisa menautkannya ke BscScan.
      throw new ApiError(
        'CHAIN_FAILED',
        `${label} masuk blok tapi REVERT (tx ${hash}). Dana tidak berpindah.`
      );
    }

    return { hash, alreadyDone: false };
  });
}

/**
 * Konfirmasi structural: mencairkan 20% dan memindahkan job ke Verifying.
 *
 * Kontrak yang menghitung angkanya, bukan backend. Nilai sebenarnya masuk
 * ke database lewat event StructuralConfirmed, ditulis indexer.
 */
export async function confirmStructuralOnChain(jobId: bigint): Promise<TxResult> {
  if (!env.chainEnabled) return { hash: HASH_DEV, alreadyDone: false };

  // Verifying / Disputed / ReleasedFull / Refunded — semuanya sudah
  // melewati structural. Mengirim ulang cuma akan revert.
  if (await sudahLewat(jobId, [3, 4, 5, 6])) {
    return { hash: HASH_SUDAH, alreadyDone: true };
  }

  return kirim('confirmStructural', jobId, () =>
    publicClient().simulateContract({
      account: walletClient().account,
      address: escrowAddress(),
      abi: geoEscrowAbi,
      functionName: 'confirmStructural',
      args: [jobId],
    })
  );
}

/**
 * Structural gagal — kembalikan job ke Accepted supaya freelancer bisa
 * submit ulang, tanpa kehilangan bond.
 *
 * `reason` masuk ke event StructuralRejected dan TERBACA PUBLIK selamanya.
 * Jangan pernah menaruh isi deliverable, alamat email, atau apa pun yang
 * bersifat pribadi di sini.
 */
export async function rejectStructuralOnChain(
  jobId: bigint,
  reason: string
): Promise<TxResult> {
  if (!env.chainEnabled) return { hash: HASH_DEV, alreadyDone: false };

  // Sudah kembali ke Accepted = penolakan sebelumnya sudah masuk.
  if (await sudahLewat(jobId, [1])) {
    return { hash: HASH_SUDAH, alreadyDone: true };
  }

  const pesan = reason.slice(0, 200);

  return kirim('rejectStructural', jobId, () =>
    publicClient().simulateContract({
      account: walletClient().account,
      address: escrowAddress(),
      abi: geoEscrowAbi,
      functionName: 'rejectStructural',
      args: [jobId, pesan],
    })
  );
}

/** Peta keputusan Oracle -> fungsi kontrak + status akhir yang ditujunya. */
const SETTLE = {
  release: { fn: 'settleRelease', tujuan: [5] },
  refund: { fn: 'settleRefund', tujuan: [6] },
  // Zona abu-abu: bukan Oracle yang memutuskan, tapi arbiter. Kontrak
  // memindahkan job ke Disputed dan menunggu arbiterDecide().
  dispute: { fn: 'raiseDispute', tujuan: [4, 5, 6] },
} as const;

/**
 * Settlement akhir. Inilah satu-satunya tempat backend memindahkan uang.
 *
 * `verdictHash` disimpan on-chain supaya hasilnya bisa diaudit: siapa pun
 * bisa mengambil verdict dari GET /api/jobs/:id/verdict, menghitung ulang
 * keccak256-nya, dan mencocokkannya dengan yang tercatat di kontrak.
 * Oracle tidak bisa mengarang ulang cerita setelah dana berpindah.
 *
 * Untuk `dispute`, tujuan mencakup 5 dan 6 juga: kalau arbiter kebetulan
 * sudah memutuskan di antara percobaan kita, jobnya sudah selesai dan
 * tidak ada yang perlu dikirim.
 */
export async function settleOnChain(
  jobId: bigint,
  decision: 'release' | 'refund' | 'dispute',
  verdictHash: Hex
): Promise<TxResult> {
  if (!env.chainEnabled) return { hash: HASH_DEV, alreadyDone: false };

  const { fn, tujuan } = SETTLE[decision];

  const job = await readJobFromChain(jobId);
  const status = job ? Number(job.status) : -1;
  if ((tujuan as readonly number[]).includes(status)) {
    return { hash: HASH_SUDAH, alreadyDone: true };
  }

  // Oracle HANYA menyelesaikan job yang sedang Verifying. `_settle` di
  // kontrak juga menerima Disputed — tanpa pagar ini, job yang sudah
  // dieskalasi ke arbiter (escalateStuckJob, atau raiseDispute sebelumnya)
  // bisa diputus Oracle dan arbiter dilangkahi.
  if (status !== 3) {
    throw new ApiError(
      'WRONG_STATUS',
      `${fn}(job ${jobId}) tidak dikirim: status on-chain ${job ? namaStatus(status) : 'tidak terbaca'}, bukan Verifying.`
    );
  }

  return kirim(fn, jobId, () =>
    publicClient().simulateContract({
      account: walletClient().account,
      address: escrowAddress(),
      abi: geoEscrowAbi,
      functionName: fn,
      args: [jobId, verdictHash],
    })
  );
}

// ══════════════════════════════════════════════════════════════════
// INFO TINGKAT-KONTRAK
// ══════════════════════════════════════════════════════════════════

export interface ChainInfo {
  chainEnabled: boolean;
  contractAddress: string | null;
  oracle: string | null;
  arbiter: string | null;
  owner: string | null;
  bondBps: string | null;
  structuralBps: string | null;
  verifyTimeoutSeconds: string | null;
}

/**
 * Cache sederhana untuk info tingkat-kontrak.
 *
 * Nilai-nilai ini hampir tidak pernah berubah (hanya lewat setOracle /
 * setArbiter / setVerifyTimeout oleh owner), tapi FE memanggil endpoint
 * ini di SETIAP halaman detail untuk memutuskan apakah panel juri
 * ditampilkan. Tanpa cache, tiap pembukaan halaman = 6 panggilan RPC.
 */
let cache: { at: number; data: ChainInfo } | null = null;
const CACHE_MS = 60_000;

/**
 * Baca konfigurasi tingkat-kontrak.
 *
 * Menggantikan kolom `jobs.arbiter_addr` yang dihapus di migrasi 01:
 * arbiter itu satu nilai untuk seluruh kontrak, bukan properti per-job.
 * Menyimpannya per baris membuat nilainya basi begitu owner memanggil
 * setArbiter() -- dan panel juri di FE akan menunjuk orang yang salah.
 */
export async function readChainInfo(): Promise<ChainInfo> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data;

  const kosong: ChainInfo = {
    chainEnabled: env.chainEnabled,
    contractAddress: null,
    oracle: null,
    arbiter: null,
    owner: null,
    bondBps: null,
    structuralBps: null,
    verifyTimeoutSeconds: null,
  };

  // Belum dikonfigurasi (Fase 0-8) -- kembalikan bentuk yang sama dengan
  // nilai null, supaya FE tidak perlu menangani dua bentuk respons.
  if (!process.env.GEO_ESCROW_ADDRESS || !process.env.RPC_URL) {
    return kosong;
  }

  const address = escrowAddress();

  // Nama fungsi sengaja TIDAK bertipe `string`: ABI yang ber-`as const`
  // membuat viem hanya menerima nama yang benar-benar ada di kontrak,
  // jadi salah ketik ditolak compiler alih-alih gagal saat runtime.
  type ViewTanpaArg = 'oracle' | 'arbiter' | 'owner' | 'BOND_BPS' | 'STRUCTURAL_BPS' | 'verifyTimeout';
  const baca = (functionName: ViewTanpaArg) =>
    publicClient().readContract({ address, abi: geoEscrowAbi, functionName });

  const [oracle, arbiter, owner, bondBps, structuralBps, timeout] =
    await Promise.all([
      baca('oracle'),
      baca('arbiter'),
      baca('owner'),
      baca('BOND_BPS'),
      baca('STRUCTURAL_BPS'),
      baca('verifyTimeout'),
    ]);

  const data: ChainInfo = {
    chainEnabled: env.chainEnabled,
    contractAddress: address,
    oracle: String(oracle),
    arbiter: String(arbiter),
    owner: String(owner),
    bondBps: String(bondBps),
    structuralBps: String(structuralBps),
    verifyTimeoutSeconds: String(timeout),
  };

  cache = { at: Date.now(), data };
  return data;
}
