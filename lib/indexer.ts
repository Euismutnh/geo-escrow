import type { Log } from 'viem';
import { db } from './db';
import { geoEscrowAbi, STATUS_BY_INDEX } from './abi';
import {
  publicClient,
  escrowAddress,
  readJobFromChain,
  type OnChainJob,
} from './chain-server';
import type { JobStatus } from './types';

/**
 * Indexer — menyalin event on-chain ke database.
 *
 * Blockchain tidak bisa memanggil server kita. Kalau freelancer menjalankan
 * `acceptJob`, kontrak cuma memancarkan event ke dalam blok; tidak ada yang
 * mengetuk pintu backend. Jadi harus ada yang rajin bertanya.
 *
 * Dua jalur, dan pembagiannya disengaja:
 *
 *   syncJob(id)   dipanggil FE tepat setelah tx dapat receipt -> instan
 *   runIndexer()  dipanggil cron tiap beberapa menit          -> jaring pengaman
 *
 * PRINSIP UTAMA: event dipakai untuk LEDGER, bukan untuk status.
 *
 * Rancangan awal menambal kolom `jobs` dari argumen event. Itu rapuh pada
 * dua titik yang sama-sama tidak bersuara: kalau satu rentang blok diproses
 * dua kali (retry, bookmark mundur, sync manual bersamaan dengan cron),
 * event lama akan MENURUNKAN status job yang sudah maju; dan kalau satu
 * event terlewat, statusnya macet tanpa ada yang tahu.
 *
 * Di sini `jobs` selalu disegarkan dari `getJob()` — satu panggilan, dan
 * hasilnya benar tanpa peduli urutan atau berapa kali log diproses.
 * Tabel `activity` yang diisi dari event, dan barisnya kebal-ganda lewat
 * `unique (tx_hash, log_index)`.
 */

/** Blok tempat kontrak di-deploy. Dipakai kalau bookmark belum ada. */
export const DEPLOY_BLOCK = 130_726_113n;

/**
 * Lebar satu rentang `eth_getLogs`.
 *
 * Diuji langsung ke publicnode (23 Sep 2026): 50.000 blok pun dilayani
 * dalam ~257ms, dan waktunya nyaris tidak naik dari 500 blok. Yang
 * dibatasi jumlah LOG yang cocok, bukan lebar rentangnya.
 *
 * 20.000 dipilih dengan sisa ruang: mengejar ketertinggalan 1,9 juta blok
 * jadi ~96 permintaan, bukan 951 seperti kalau memakai 2.000 — sambil
 * menyisakan jarak jauh dari batas yang terbukti (50.000), supaya tidak
 * mepet begitu kontraknya ramai.
 */
const CHUNK_BLOCKS = 20_000n;

/**
 * Batas KERAS dari RPC: `exceed maximum block range: 50000`.
 *
 * Ditemukan saat menjalankan uji, bukan saat membaca dokumentasi. Yang
 * penting: filter topic TIDAK membebaskan batas ini. Rancangan awal
 * menyarankan `syncJob` membaca dari blok deploy sampai `latest` dengan
 * alasan "hasilnya sudah tersaring jobId" — RPC menolak permintaannya
 * jauh sebelum penyaringan itu terjadi.
 */
const MAX_RENTANG_RPC = 50_000n;

/**
 * Seberapa jauh ke belakang `syncJob` mencari log untuk ledger.
 *
 * Tidak perlu jauh: sync dipanggil FE beberapa detik setelah transaksi
 * dapat receipt, jadi log yang dicari ada di ujung rantai. 45.000 blok
 * (~5,6 jam pada 0,45 detik/blok) sudah sangat longgar, dan menyisakan
 * jarak dari batas keras di atas.
 *
 * Ledger yang lebih tua diisi `runIndexer()` sambil menyusul — dan
 * KEBENARAN job tidak bergantung pada jendela ini sama sekali, karena
 * kolom `jobs` selalu diambil dari getJob().
 */
const SYNC_LOOKBACK = 45_000n;

/**
 * Seberapa jauh ke belakang RPC publik MASIH MENYIMPAN log.
 *
 * Ini kendala terpenting di seluruh Fase 10, dan tidak tertulis di
 * dokumentasi mana pun — ketahuan saat menjalankan uji:
 *
 *     History has been pruned for this block.
 *
 * Diukur 23 Sep 2026 di publicnode: **~90.000 blok, sekitar 11 jam**.
 * Kontrak di-deploy 1,9 juta blok sebelumnya. Artinya menyusul dari blok
 * deploy BUKAN "lambat" — melainkan **mustahil**: node-nya sudah tidak
 * punya datanya, dan tiap permintaan ditolak -32701.
 *
 * 80.000 dipakai sebagai batas kerja, menyisakan jarak dari 90.000 yang
 * terukur (angkanya bergeser terus mengikuti ujung rantai).
 *
 * KONSEKUENSI YANG HARUS DISADARI: `activity` hanya bisa memuat event
 * dari ~11 jam terakhir. Untuk hackathon ini tidak ada yang hilang —
 * `jobCount()` masih 0, jadi belum ada event sama sekali. Tapi kalau
 * ledger harus lengkap sejak awal, RPC-nya harus diganti yang arsip
 * (Alchemy/QuickNode/Ankr punya tier gratis dengan akses arsip).
 *
 * Yang TIDAK terpengaruh: status dan nilai uang tiap job. Itu datang dari
 * `getJob()`, yang membaca storage saat ini — bukan dari log.
 */
const RETENSI_LOG = 80_000n;

/**
 * Batas rentang per pemanggilan, supaya satu invocation serverless tidak
 * kehabisan waktu. Sisanya dikerjakan putaran berikutnya — bookmark
 * disimpan setiap selesai satu rentang, jadi tidak ada kerja yang terbuang.
 */
const MAX_CHUNKS_PER_RUN = 12;

/**
 * Jarak aman dari ujung rantai untuk jalur cron.
 *
 * Blok paling ujung masih bisa tergeser reorg. Kalau bookmark sudah
 * terlanjur melewatinya, event di blok yang tergeser itu TIDAK akan
 * pernah dibaca ulang — hilang diam-diam. 15 blok pada 0,45 detik/blok
 * cuma ~7 detik keterlambatan, dan jalur `syncJob` tetap membaca sampai
 * `latest` jadi demo tidak ikut melambat.
 */
const CONFIRMATIONS = 15n;

// ══════════════════════════════════════════════════════════════════
// Pemetaan event -> baris ledger
// ══════════════════════════════════════════════════════════════════

type ActivityType =
  | 'deposit'
  | 'bond_lock'
  | 'structural_release'
  | 'structural_rejected'
  | 'dispute_raised'
  | 'vrf_pick'
  | 'final_release'
  | 'final_refund'
  | 'jury_release'
  | 'jury_refund'
  | 'bond_return'
  | 'bond_slash'
  | 'reclaim';

export interface BarisActivity {
  type: ActivityType;
  amount_wei?: string | null;
  from_addr?: string | null;
  to_addr?: string | null;
  note?: string | null;
}

/** Log yang sudah diurai viem dari ABI kita. */
export type LogTerurai = Log<bigint, number, false> & {
  eventName?: string;
  args?: Record<string, unknown>;
};

/**
 * Ambil jobId dari sebuah log.
 *
 * `undefined` berarti event tingkat-kontrak (OracleChanged, ArbiterChanged,
 * OwnershipTransferred, VerifyTimeoutChanged) — bukan milik job mana pun.
 *
 * Sentinelnya sengaja BUKAN 0. Sudah dibuktikan di Fase 9 bahwa jobId
 * pertama adalah 0, jadi `log.args?.jobId ?? 0` akan membuat setiap event
 * non-job menyamar jadi event milik job 0.
 */
/** @internal diekspor supaya bisa diuji langsung — lihat scripts/dev-indexer.ts */
export function jobIdDari(log: LogTerurai): number | null {
  const raw = log.args?.jobId;
  if (raw === undefined || raw === null) return null;
  return Number(raw);
}

/**
 * Terjemahkan satu event jadi baris ledger.
 *
 * `null` = event ini memang tidak mewakili pergerakan apa pun yang perlu
 * dicatat, bukan "belum sempat ditangani":
 *
 *   DeliverableSubmitted  tidak ada uang bergerak; statusnya sudah
 *                         tercermin lewat getJob()
 *   ArbiterDecided        selalu diikuti `Settled` di transaksi yang SAMA,
 *                         dan Settled yang membawa jumlah + penerimanya.
 *                         Mencatat keduanya = satu pencairan tampil dua kali
 */
/** @internal diekspor supaya bisa diuji langsung — lihat scripts/dev-indexer.ts */
export function keBarisActivity(
  log: LogTerurai,
  onChain: OnChainJob | null
): BarisActivity | null {
  const a = log.args ?? {};
  const kontrak = escrowAddress().toLowerCase();

  switch (log.eventName) {
    case 'JobCreated':
      return {
        type: 'deposit',
        amount_wei: String(a.budget),
        from_addr: String(a.client).toLowerCase(),
        to_addr: kontrak,
        note: 'Dana dikunci di escrow',
      };

    case 'JobAccepted':
      return {
        type: 'bond_lock',
        amount_wei: String(a.bond),
        from_addr: String(a.freelancer).toLowerCase(),
        to_addr: kontrak,
        note: 'Bond freelancer dikunci',
      };

    case 'StructuralConfirmed':
      return {
        type: 'structural_release',
        amount_wei: String(a.amount),
        from_addr: kontrak,
        // Event ini TIDAK membawa `freelancer` — rancangan awal membaca
        // `log.args.freelancer` dan menulis undefined ke kolom ini, jadi
        // pencairan 20% tampil tanpa penerima. Alamatnya diambil dari
        // kontrak, bukan dari event.
        to_addr: onChain?.freelancer?.toLowerCase() ?? null,
        note: 'Structural check lolos — 20% dicairkan',
      };

    case 'StructuralRejected':
      return {
        type: 'structural_rejected',
        note: String(a.reason ?? '').slice(0, 200),
      };

    case 'DisputeRaised':
      return {
        type: 'dispute_raised',
        note: `Skor di zona abu — diteruskan ke juri (verdict ${String(a.verdictHash).slice(0, 10)}…)`,
      };

    case 'Settled': {
      const keFreelancer = a.toFreelancer === true;
      const olehJuri = a.byArbiter === true;
      return {
        type: olehJuri
          ? keFreelancer
            ? 'jury_release'
            : 'jury_refund'
          : keFreelancer
            ? 'final_release'
            : 'final_refund',
        amount_wei: String(a.amount),
        from_addr: kontrak,
        to_addr: String(a.recipient).toLowerCase(),
        note: olehJuri
          ? keFreelancer
            ? 'Juri memutuskan: cairkan ke freelancer'
            : 'Juri memutuskan: refund ke client'
          : keFreelancer
            ? 'Target tercapai — sisa dana dicairkan'
            : 'Target tidak tercapai — dana dikembalikan',
      };
    }

    case 'BondSettled':
      return {
        type: a.slashed === true ? 'bond_slash' : 'bond_return',
        amount_wei: String(a.amount),
        from_addr: kontrak,
        to_addr: String(a.recipient).toLowerCase(),
        note:
          a.slashed === true
            ? 'Bond freelancer di-slash (gagal capai target)'
            : 'Bond freelancer dikembalikan',
      };

    case 'Reclaimed':
      return {
        type: 'reclaim',
        amount_wei: String(a.amount),
        from_addr: kontrak,
        to_addr: String(a.client).toLowerCase(),
        note: 'Tidak ada freelancer sampai batas waktu — dana ditarik client',
      };

    default:
      return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// Penulisan ke database
// ══════════════════════════════════════════════════════════════════

/**
 * Segarkan satu baris `jobs` dari kontrak.
 *
 * Inilah yang membuat indexer tahan diproses ulang. Nilainya diambil dari
 * `getJob()`, bukan dirangkai dari event, jadi hasilnya sama saja entah
 * log-nya dibaca sekali, dua kali, atau berurutan terbalik.
 *
 * `status` di sini adalah SATU-SATUNYA tempat kolom itu ditulis (§2.1) —
 * jalur Oracle tidak pernah menyentuhnya.
 */
async function segarkanJob(jobId: number, onChain: OnChainJob): Promise<boolean> {
  const status = STATUS_BY_INDEX[Number(onChain.status)] as JobStatus | undefined;
  if (!status) {
    throw new Error(
      `Status on-chain ${onChain.status} untuk job ${jobId} tidak dikenal. ` +
        `Kontraknya kemungkinan di-deploy ulang dengan enum berbeda — ` +
        `periksa STATUS_BY_INDEX di lib/abi.ts.`
    );
  }

  // bytes32 kosong berarti "belum diisi", bukan nilai nol yang bermakna.
  const isiAtauNull = (v: string | undefined) =>
    v && !/^0x0*$/.test(v) ? v : null;

  // Alamat nol = belum ada freelancer.
  const alamatAtauNull = (v: string | undefined) =>
    v && !/^0x0*$/.test(v) ? v.toLowerCase() : null;

  const { data, error } = await db()
    .from('jobs')
    .update({
      status,
      freelancer_addr: alamatAtauNull(onChain.freelancer),
      // Semua nilai wei disimpan sebagai TEXT. String(bigint) tidak pernah
      // kehilangan presisi; Number() akan, di atas 2^53 (~0,009 tBNB).
      budget_wei: String(onChain.budget),
      bond_wei: onChain.bond > 0n ? String(onChain.bond) : null,
      structural_released_wei: String(onChain.structuralReleased),
      deliverable_hash: isiAtauNull(onChain.deliverableHash),
      verdict_hash: isiAtauNull(onChain.verdictHash),
      verification_seed: isiAtauNull(onChain.verificationSeed),
      accept_deadline: new Date(Number(onChain.acceptDeadline) * 1000).toISOString(),
    })
    .eq('job_id', jobId)
    .select('job_id');

  if (error) throw new Error(`gagal menyegarkan job ${jobId}: ${error.message}`);

  const ketemu = (data ?? []).length > 0;
  if (!ketemu) {
    // Bukan error. `createJob()` bisa dipanggil langsung dari Etherscan
    // atau skrip lain, dan job seperti itu tidak punya metadata (brand,
    // queries) di database kita — jadi memang tidak bisa ditampilkan.
    // Dicatat supaya tidak membingungkan saat debug.
    console.warn(
      `[indexer] job ${jobId} ada on-chain tapi tidak ada di DB — dibuat di luar aplikasi?`
    );
  }
  return ketemu;
}

/**
 * Tulis satu baris ledger. Mengembalikan true kalau barisnya BARU.
 *
 * `unique (tx_hash, log_index)` yang menjaga dari duplikat, dan
 * `ignoreDuplicates` membuat log yang sudah pernah diproses lewat begitu
 * saja tanpa error. Itu yang membuat sync manual boleh bertabrakan dengan
 * cron tanpa menghasilkan ledger ganda.
 */
async function tulisActivity(
  log: LogTerurai,
  jobId: number,
  baris: BarisActivity
): Promise<boolean> {
  const { data, error } = await db()
    .from('activity')
    .upsert(
      {
        job_id: jobId,
        tx_hash: log.transactionHash,
        log_index: log.logIndex,
        block_number: Number(log.blockNumber),
        type: baris.type,
        amount_wei: baris.amount_wei ?? null,
        from_addr: baris.from_addr ?? null,
        to_addr: baris.to_addr ?? null,
        note: baris.note ?? null,
      },
      { onConflict: 'tx_hash,log_index', ignoreDuplicates: true }
    )
    .select('id');

  if (error) throw new Error(`gagal menulis activity: ${error.message}`);
  return (data ?? []).length > 0;
}

export interface HasilIndex {
  /** Jumlah log yang dibaca dari rantai. */
  logs: number;
  /** Baris ledger yang benar-benar baru (sisanya sudah pernah diproses). */
  activityBaru: number;
  /** jobId yang barisnya disegarkan dari kontrak. */
  jobTersentuh: number[];
}

/**
 * Terapkan sekumpulan log ke database.
 *
 * Log dikelompokkan per job supaya `getJob()` cukup dipanggil SEKALI per
 * job, bukan sekali per event — satu settlement saja memancarkan tiga
 * event (Settled, BondSettled, dan kadang ArbiterDecided).
 */
export async function terapkanLogs(logs: LogTerurai[]): Promise<HasilIndex> {
  const perJob = new Map<number, LogTerurai[]>();

  for (const log of logs) {
    const jobId = jobIdDari(log);
    if (jobId === null) continue; // event tingkat-kontrak, bukan milik job
    const daftar = perJob.get(jobId);
    if (daftar) daftar.push(log);
    else perJob.set(jobId, [log]);
  }

  let activityBaru = 0;
  const jobTersentuh: number[] = [];

  for (const [jobId, daftar] of perJob) {
    // Urutkan supaya catatan ledger terbaca runut di halaman Aktivitas.
    // Kebenaran kolom `jobs` TIDAK bergantung pada urutan ini — itu
    // datang dari getJob() — tapi urutan tampilan tetap penting.
    daftar.sort((x, y) =>
      x.blockNumber === y.blockNumber
        ? (x.logIndex ?? 0) - (y.logIndex ?? 0)
        : Number((x.blockNumber ?? 0n) - (y.blockNumber ?? 0n))
    );

    const onChain = await readJobFromChain(BigInt(jobId));

    for (const log of daftar) {
      const baris = keBarisActivity(log, onChain);
      if (!baris) continue;
      if (await tulisActivity(log, jobId, baris)) activityBaru++;
    }

    if (onChain) {
      await segarkanJob(jobId, onChain);
      jobTersentuh.push(jobId);
    }
  }

  return { logs: logs.length, activityBaru, jobTersentuh };
}

// ══════════════════════════════════════════════════════════════════
// Jalur 1: sync satu job (instan, dipanggil FE)
// ══════════════════════════════════════════════════════════════════

export interface HasilSync extends HasilIndex {
  jobId: number;
  adaDiChain: boolean;
}

/**
 * Sinkronkan SATU job, dari blok deploy sampai ujung rantai.
 *
 * `jobId` bertanda `indexed` di semua event job, jadi penyaringannya
 * dikerjakan RPC lewat topic — bukan diunduh semua lalu dibuang di sini.
 * Karena hasilnya sudah tersaring, rentangnya boleh dari blok deploy:
 * tidak ada jendela waktu yang bisa terlewat.
 *
 * Rancangan awal mengambil 5.000 blok terakhir lalu menyaring di klien.
 * Di BSC Testnet 5.000 blok cuma 38 menit (§10.2a) — job yang dibuat
 * pagi ini tidak akan pernah tersinkron sore harinya.
 */
export async function syncJob(jobId: number): Promise<HasilSync> {
  // Kebenaran job datang dari sini, BUKAN dari log. Satu panggilan, dan
  // hasilnya lengkap tanpa peduli seberapa tua job-nya -- itulah kenapa
  // jendela log di bawah boleh pendek.
  const onChain = await readJobFromChain(BigInt(jobId));

  if (!onChain) {
    return { jobId, adaDiChain: false, logs: 0, activityBaru: 0, jobTersentuh: [] };
  }

  const adaDiDb = await segarkanJob(jobId, onChain);

  // Ledger: cari log di jendela terbatas. RPC menolak rentang di atas
  // 50.000 blok, filter topic atau tidak.
  const tip = await publicClient().getBlockNumber();
  const dari = tip > SYNC_LOOKBACK ? tip - SYNC_LOOKBACK : DEPLOY_BLOCK;

  const logs = (await publicClient().getContractEvents({
    address: escrowAddress(),
    abi: geoEscrowAbi,
    // jobId bertanda `indexed` di semua event job, jadi penyaringannya
    // dikerjakan RPC lewat topic -- bukan diunduh semua lalu dibuang di sini.
    args: { jobId: BigInt(jobId) },
    fromBlock: dari < DEPLOY_BLOCK ? DEPLOY_BLOCK : dari,
    toBlock: tip,
  })) as unknown as LogTerurai[];

  let activityBaru = 0;
  for (const log of logs) {
    const baris = keBarisActivity(log, onChain);
    if (!baris) continue;
    if (await tulisActivity(log, jobId, baris)) activityBaru++;
  }

  return {
    jobId,
    adaDiChain: true,
    logs: logs.length,
    activityBaru,
    jobTersentuh: adaDiDb ? [jobId] : [],
  };
}

// ══════════════════════════════════════════════════════════════════
// Jalur 2: poll semua job (cron, jaring pengaman)
// ══════════════════════════════════════════════════════════════════

/** Bookmark terakhir untuk alamat kontrak yang sedang aktif. */
async function bacaBookmark(alamat: string): Promise<bigint | null> {
  const { data, error } = await db()
    .from('indexer_state')
    .select('last_block_processed')
    .eq('contract_addr', alamat)
    .maybeSingle();

  if (error) throw new Error(`gagal membaca indexer_state: ${error.message}`);
  if (!data) return null;
  return BigInt(data.last_block_processed);
}

async function simpanBookmark(alamat: string, blok: bigint): Promise<void> {
  const { error } = await db()
    .from('indexer_state')
    .upsert(
      {
        contract_addr: alamat,
        last_block_processed: Number(blok),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'contract_addr' }
    );

  if (error) throw new Error(`gagal menyimpan indexer_state: ${error.message}`);
}

export interface HasilPoll {
  dariBlok: string;
  sampaiBlok: string;
  tipRantai: string;
  /**
   * Blok yang dilewati karena log-nya sudah dipangkas RPC. > 0 berarti
   * ada event yang TIDAK akan pernah masuk ledger — muncul di respons
   * supaya keputusannya kelihatan, bukan terkubur di log server.
   */
  blokDilompati: string;
  rentangDiproses: number;
  /** true = masih ada sisa; panggil lagi tanpa menunggu jadwal berikutnya. */
  masihAdaSisa: boolean;
  logs: number;
  activityBaru: number;
  jobTersentuh: number[];
}

/**
 * Susuri blok baru sejak bookmark terakhir.
 *
 * Bookmark disimpan SETIAP selesai satu rentang, bukan sekali di akhir.
 * Kalau invocation-nya terpotong di tengah, kerja yang sudah selesai
 * tidak terbuang — putaran berikutnya melanjutkan dari situ.
 */
export async function runIndexer(): Promise<HasilPoll> {
  const alamat = escrowAddress().toLowerCase();

  const tip = await publicClient().getBlockNumber();

  // Jangan sentuh blok paling ujung: masih bisa tergeser reorg, dan
  // bookmark yang terlanjur melewatinya membuat event di blok itu hilang
  // tanpa jejak.
  const aman = tip > CONFIRMATIONS ? tip - CONFIRMATIONS : 0n;

  let bookmark = await bacaBookmark(alamat);
  if (bookmark === null) {
    // Baris belum disemai. Mulai dari blok deploy adalah pilihan yang
    // benar untuk kontrak yang kita kenal; untuk alamat lain kita tidak
    // tahu kapan ia lahir, tapi mulai dari DEPLOY_BLOCK tetap jauh lebih
    // baik daripada dari 0 — paling buruk ia menyisir blok kosong sekali.
    bookmark = DEPLOY_BLOCK - 1n;
    console.warn(
      `[indexer] indexer_state untuk ${alamat} belum ada — mulai dari blok ` +
        `${bookmark}. Semai barisnya lewat supabase/migration-01-*.sql ` +
        `supaya tidak mengulang penyisiran ini.`
    );
  }

  if (CHUNK_BLOCKS > MAX_RENTANG_RPC) {
    throw new Error(
      `CHUNK_BLOCKS (${CHUNK_BLOCKS}) melewati batas RPC ${MAX_RENTANG_RPC}. ` +
        `Setiap permintaan akan ditolak -32701.`
    );
  }

  // Klem ke horizon pemangkasan. Tanpa ini, bookmark yang tertinggal jauh
  // membuat SETIAP putaran gagal di rentang pertama dengan -32701, dan
  // indexer tidak pernah maju satu blok pun.
  const tertua = tip > RETENSI_LOG ? tip - RETENSI_LOG : 0n;
  let dilompati = 0n;

  if (bookmark + 1n < tertua) {
    dilompati = tertua - (bookmark + 1n);
    console.warn(
      `[indexer] bookmark ${bookmark} lebih tua dari log yang masih disimpan ` +
        `RPC (tertua ~${tertua}). ${dilompati} blok DILOMPATI — event di ` +
        `rentang itu tidak akan pernah masuk ledger. Status job tidak ` +
        `terpengaruh (diambil dari getJob). Untuk ledger yang lengkap, ` +
        `pakai RPC arsip.`
    );
    bookmark = tertua - 1n;
    // Disimpan sekarang supaya lompatan ini tidak diulang tiap putaran.
    await simpanBookmark(alamat, bookmark);
  }

  const total: HasilIndex = { logs: 0, activityBaru: 0, jobTersentuh: [] };
  let rentang = 0;
  let dari = bookmark + 1n;
  // Dicatat sebelum loop: rentang TERAKHIR hampir selalu lebih pendek dari
  // CHUNK_BLOCKS (dipotong di `aman`), jadi titik awal tidak bisa dihitung
  // mundur dari bookmark akhir.
  const mulaiDari = dari;

  while (dari <= aman && rentang < MAX_CHUNKS_PER_RUN) {
    const sampai = dari + CHUNK_BLOCKS - 1n > aman ? aman : dari + CHUNK_BLOCKS - 1n;

    const logs = (await publicClient().getContractEvents({
      address: escrowAddress(),
      abi: geoEscrowAbi,
      fromBlock: dari,
      toBlock: sampai,
    })) as unknown as LogTerurai[];

    const hasil = await terapkanLogs(logs);
    total.logs += hasil.logs;
    total.activityBaru += hasil.activityBaru;
    for (const id of hasil.jobTersentuh) {
      if (!total.jobTersentuh.includes(id)) total.jobTersentuh.push(id);
    }

    // Disimpan di sini, bukan setelah loop: invocation yang terpotong
    // tidak boleh membuang rentang yang sudah benar-benar selesai.
    await simpanBookmark(alamat, sampai);

    bookmark = sampai;
    dari = sampai + 1n;
    rentang++;
  }

  return {
    dariBlok: String(mulaiDari),
    sampaiBlok: String(bookmark),
    tipRantai: String(tip),
    blokDilompati: String(dilompati),
    rentangDiproses: rentang,
    masihAdaSisa: bookmark < aman,
    ...total,
  };
}
