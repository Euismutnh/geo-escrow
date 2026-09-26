import { parseEventLogs, type Log } from 'viem';
import { geoEscrowAbi } from './abi';
import { api, apiPost, ApiClientError } from './api';
import { queryPoolHash } from './hash';
import type { DraftCheck } from './job-input';
import { toUnixSeconds } from './job-input';
import type { Job } from './types';

/*
 * Alur "Buat kontrak" (blueprint Fase 6, urutan yang dikunci):
 *
 *   1. h = queryPoolHash(...)                       ← lib/hash.ts, SAMA dengan server
 *   2. d = Date, dibaca SEKALI                        ← §A7
 *   3. createJob(h, detik(d)) { value: budget }       ← <TxButton>
 *   4. receipt → event JobCreated → jobId             ← BUKAN nilai balik fungsi
 *   5. POST /api/jobs (d.toISOString())
 *   6. POST /api/sync/:id                             ← <TxButton>
 *
 * Semua yang dikirim di langkah 3 dan 5 berasal dari SATU snapshot yang
 * dibekukan saat tombol diklik. Kalau form diubah di tengah jalan, atau
 * langkah 5 diulang, yang dipakai tetap snapshot itu — hash di chain
 * tidak bisa diubah lagi.
 */

export interface CreateSnapshot {
  clientAddr: string;
  contract: string;
  brand: string;
  brief: string | null;
  queries: string[];
  targetCount: number;
  multiEngine: boolean;
  /** wei sebagai string — JSON tidak punya BigInt. */
  budgetWei: string;
  /** uint64 detik, sebagai string. */
  deadlineSec: string;
  /** ISO dari DETIK YANG SAMA (tanpa milidetik) — identik dengan on-chain. */
  deadlineIso: string;
  queryPoolHash: `0x${string}`;
}

/** Bekukan isian yang SUDAH lolos checkDraft(). */
export function makeSnapshot(c: DraftCheck, multiEngine: boolean, clientAddr: string, contract: string): CreateSnapshot {
  if (!c.deadline || c.budgetWei === null) throw new Error('Isian belum lengkap');
  const sec = toUnixSeconds(c.deadline);
  return {
    clientAddr,
    contract,
    brand: c.brand,
    brief: c.brief,
    queries: c.queries,
    targetCount: c.targetCount,
    multiEngine,
    budgetWei: c.budgetWei.toString(),
    deadlineSec: sec.toString(),
    deadlineIso: new Date(Number(sec) * 1000).toISOString(),
    queryPoolHash: queryPoolHash({ brand: c.brand, queries: c.queries, targetCount: c.targetCount, multiEngine }),
  };
}

const lc = (a: string) => a.toLowerCase();

/**
 * jobId dari event JobCreated di receipt — satu-satunya sumber yang
 * otoritatif (nilai balik fungsi payable tidak ada di receipt).
 *
 * Diperiksa juga bahwa event itu memang untuk transaksi INI: dari kontrak
 * kita, client-nya wallet ini, hash & budget-nya persis snapshot. Kalau ada
 * yang beda, lebih baik berhenti di sini daripada menyimpan metadata ke
 * job yang salah.
 *
 * jobId 0 SAH — pemeriksaannya Number.isSafeInteger, bukan truthiness (§A9).
 */
export function jobIdFromReceipt(logs: readonly Log[], s: Pick<CreateSnapshot, 'contract' | 'clientAddr' | 'queryPoolHash' | 'budgetWei'>): number {
  const events = parseEventLogs({ abi: geoEscrowAbi, eventName: 'JobCreated', logs: logs as Log[] })
    .filter((e) => lc(e.address) === lc(s.contract));
  if (events.length !== 1) throw new Error(`Receipt memuat ${events.length} event JobCreated dari kontrak ini, bukan 1`);
  const a = events[0].args;
  if (lc(a.client) !== lc(s.clientAddr)) throw new Error('Client di event berbeda dari wallet yang mengirim');
  if (lc(a.queryPoolHash) !== lc(s.queryPoolHash)) throw new Error('queryPoolHash di event berbeda dari yang dihitung');
  if (a.budget.toString() !== s.budgetWei) throw new Error('Budget di event berbeda dari yang dikirim');
  const id = Number(a.jobId);
  if (!Number.isSafeInteger(id) || id < 0) throw new Error(`jobId ${a.jobId} di luar jangkauan`);
  return id;
}

/** Body POST /api/jobs — bentuk yang diterima app/api/jobs/route.ts, TIDAK diubah. */
export function metadataBody(s: CreateSnapshot, jobId: number) {
  return {
    jobId,
    clientAddr: s.clientAddr,
    brand: s.brand,
    brief: s.brief,
    queries: s.queries,
    targetCount: s.targetCount,
    multiEngine: s.multiEngine,
    budgetWei: s.budgetWei,
    acceptDeadline: s.deadlineIso,
  };
}

const RATE_RETRY_MS = 5_100; // server: 1 job per wallet per 5 detik

/**
 * POST /api/jobs yang IDEMPOTEN. Kalau POST sebelumnya sebenarnya berhasil
 * tapi responsnya hilang, percobaan ulang akan ditolak "sudah terdaftar" —
 * jadi setiap kegagalan dicek dulu ke GET /api/jobs/:id: job ada dengan
 * hash yang sama = sudah tersimpan = sukses.
 */
export async function saveJobMetadata(s: CreateSnapshot, jobId: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await apiPost('/api/jobs', metadataBody(s, jobId));
      return;
    } catch (e) {
      const saved = await api<{ job: Job }>(`/api/jobs/${jobId}`).then((r) => r.job).catch(() => null);
      if (saved && lc(saved.query_pool_hash) === lc(s.queryPoolHash)) return;
      if (e instanceof ApiClientError && e.code === 'RATE_LIMITED' && attempt === 0) {
        await new Promise((r) => setTimeout(r, RATE_RETRY_MS));
        continue;
      }
      throw e instanceof ApiClientError ? new Error(e.message) : e;
    }
  }
}

// ---------------------------------------------------------------------
// Transaksi yang terkirim tapi metadatanya belum tersimpan
// ---------------------------------------------------------------------

/**
 * Kalau tab ditutup setelah transaksi terkirim tapi sebelum POST /api/jobs
 * selesai, dana terkunci di kontrak TANPA metadata — job itu tidak punya
 * halaman, jadi reclaimExpired pun tidak bisa diakses dari UI. Catatan ini
 * disimpan begitu hash didapat, dan /create menawarkan melanjutkannya.
 * Disimpan di browser pengguna itu saja; tidak berisi rahasia apa pun.
 */
export interface PendingCreate { hash: `0x${string}`; snapshot: CreateSnapshot; at: number }

/**
 * DAFTAR catatan, satu per hash transaksi. Dulu satu slot (v1): kontrak
 * kedua — atau wallet lain di browser yang sama — MENIMPA catatan kontrak
 * pertama, dan budget-nya terkunci tanpa metadata tanpa jejak di mana pun.
 * Tidak ada batas jumlah: membuang catatan lama = membuang satu-satunya
 * jalan memulihkan dana. /create juga menolak membuat kontrak baru selama
 * masih ada catatan, jadi daftarnya praktis tidak pernah panjang.
 */
export const PENDING_KEY = 'geo:create-pending:v2';
/** Kunci lama (satu slot). Tetap dibaca, dipindah ke daftar saat ditulis berikutnya. */
export const PENDING_KEY_V1 = 'geo:create-pending:v1';
/** Event di tab yang SAMA (event 'storage' hanya datang dari tab lain). */
export const PENDING_EVENT = 'geo:create-pending';
const notify = () => { try { window.dispatchEvent(new Event(PENDING_EVENT)); } catch { /* bukan browser */ } };
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };

const isPending = (p: unknown): p is PendingCreate =>
  !!p && typeof p === 'object' && typeof (p as PendingCreate).hash === 'string' && !!(p as PendingCreate).snapshot;

/** Isi mentah kedua kunci. */
export interface PendingRaw { v2: string | null; v1: string | null }

/** Semua catatan dari isi mentah, TANPA saringan wallet — rusak = diabaikan. */
export function parsePendingAll(raw: PendingRaw): PendingCreate[] {
  const out: PendingCreate[] = [];
  try {
    const list: unknown = raw.v2 ? JSON.parse(raw.v2) : [];
    if (Array.isArray(list)) for (const p of list) if (isPending(p) && !out.some((x) => x.hash === p.hash)) out.push(p);
  } catch { /* rusak: abaikan */ }
  try {
    const one: unknown = raw.v1 ? JSON.parse(raw.v1) : null;
    if (isPending(one) && !out.some((x) => x.hash === one.hash)) out.push(one);
  } catch { /* rusak: abaikan */ }
  return out;
}

/** Catatan milik wallet + kontrak ini saja, terlama dulu. */
export function parsePending(raw: PendingRaw, clientAddr: string | undefined, contract: string | null | undefined): PendingCreate[] {
  if (!clientAddr || !contract) return [];
  return parsePendingAll(raw)
    .filter((p) => lc(p.snapshot.clientAddr) === lc(clientAddr) && lc(p.snapshot.contract) === lc(contract))
    .sort((a, b) => a.at - b.at);
}

/** Snapshot primitif untuk useSyncExternalStore (string sama = tidak berubah). */
export function readPendingRaw(): string {
  return JSON.stringify({ v2: get(PENDING_KEY), v1: get(PENDING_KEY_V1) } satisfies PendingRaw);
}

function writeAll(list: PendingCreate[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
    localStorage.removeItem(PENDING_KEY_V1);
  } catch { /* private mode: tanpa pemulihan */ }
  notify();
}

const readAll = () => parsePendingAll({ v2: get(PENDING_KEY), v1: get(PENDING_KEY_V1) });

export function savePending(p: PendingCreate): void {
  writeAll([...readAll().filter((x) => x.hash !== p.hash), p]);
}

/** Hapus SATU catatan — yang lain (kontrak lain, wallet lain) tetap. */
export function clearPending(hash: string): void {
  writeAll(readAll().filter((x) => x.hash !== hash));
}

// ---------------------------------------------------------------------
// §A8 — HANYA saat CHAIN_ENABLED=false
// ---------------------------------------------------------------------

/**
 * Mulai dari 900000, bukan dari 0: job on-chain mulai dari 0, jadi job dev
 * ber-id rendah akan BERTABRAKAN begitu chain dinyalakan (peringatan
 * check:security §7 soal seed). Rentang ini jauh dari jangkauan jobCount
 * testnet mana pun.
 */
export const DEV_ID_BASE = 900_000;

export async function jobIdDevSaja(): Promise<number> {
  const { jobs } = await api<{ jobs: Pick<Job, 'job_id'>[] }>('/api/jobs?limit=50');
  return Math.max(DEV_ID_BASE - 1, ...jobs.map((j) => j.job_id)) + 1;
}
