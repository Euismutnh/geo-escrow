import { apiPost, ApiClientError } from './api';
import type { UiStatus } from './status';
import { isAcceptExpired } from './job-view';
import { sameAddr } from './tx';
import type { Job } from './types';

/*
 * Fase 7 — ambil kontrak & kirim hasil. Penjaga (siapa boleh menekan apa)
 * MURNI supaya diuji di check-pure; pengiriman konten memakai endpoint yang
 * sudah ada, tanpa mengubah bentuknya.
 *
 * Pesan penolakan kontrak (dibaca dari bytecode GeoEscrow): acceptJob →
 * "GEO: job tidak terbuka", "GEO: sudah kedaluwarsa", "GEO: client tidak
 * boleh ambil sendiri", "GEO: nilai bond tidak sesuai"; submitDeliverable →
 * "GEO: bukan freelancer job ini", "GEO: status salah", "GEO: hash kosong".
 * Penjaga di bawah menolak lebih dulu dengan kalimat yang lebih jelas, dan
 * simulasi di <TxButton> tetap menangkap sisanya sebelum gas terbayar.
 */

export type Allowed = { ok: true } | { ok: false; reason: string };
const OK: Allowed = { ok: true };
const no = (reason: string): Allowed => ({ ok: false, reason });

/**
 * Tombol "Ambil kontrak". Wallet terputus → ok: <TxButton> sendiri yang
 * menampilkan "Hubungkan wallet".
 *
 * Baseline wajib selesai: freelancer menanggung bond atas target yang
 * diukur dari titik awal itu — mengambil sebelum tahu titik awalnya
 * berarti menandatangani risiko yang belum terlihat.
 */
export function acceptGuard(
  job: Pick<Job, 'status' | 'accept_deadline' | 'client_addr'>,
  ui: UiStatus,
  wallet: string | undefined,
  roles: { oracle?: string | null; arbiter?: string | null } | undefined,
  now: number | null
): Allowed {
  if (ui === 'baseline_running') return no('Tunggu baseline selesai diukur — titik awalnya perlu terlihat sebelum Anda mengunci bond.');
  if (ui === 'baseline_failed') return no('Baseline gagal diukur. Kontrak bisa diambil setelah client mengukur ulang.');
  if (ui !== 'open') return no('Kontrak ini sudah tidak terbuka.');
  if (isAcceptExpired(job, now)) return no('Batas ambil sudah lewat — kontrak ini tidak bisa diambil lagi.');
  if (!wallet) return OK;
  if (sameAddr(job.client_addr, wallet)) return no('Anda client kontrak ini. Kontrak menolak client mengambil kontraknya sendiri.');
  if (sameAddr(roles?.arbiter, wallet)) return no('Wallet arbiter tidak mengambil kontrak — arbiter yang memutus sengketanya.');
  if (sameAddr(roles?.oracle, wallet)) return no('Wallet ini dipakai Oracle di backend. Gunakan wallet lain untuk bekerja sebagai freelancer.');
  return OK;
}

/** Tombol "Tanda tangani & kirim" hasil kerja. */
export function submitGuard(job: Pick<Job, 'status' | 'freelancer_addr'>, wallet: string | undefined): Allowed {
  if (job.status !== 'Accepted') return no('Hasil hanya bisa dikirim saat kontrak sedang dikerjakan.');
  if (!wallet) return OK;
  if (!sameAddr(job.freelancer_addr, wallet)) return no('Hanya freelancer kontrak ini yang bisa mengirim hasil.');
  return OK;
}

// ---------------------------------------------------------------------
// POST /api/jobs/:id/deliverable
// ---------------------------------------------------------------------

type DeliverableRes = { deliverableHash: `0x${string}`; structuralPass: boolean; length: number };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const RATE_RETRY_MS = 2_100; // server: 1 kiriman per job per 2 detik

/**
 * Kirim konten ke server (structural check jalan di sana, SEBELUM gas).
 *
 * Revisi sebelum tanda tangan bebas: server mengunci konten ke hash
 * ON-CHAIN (lib/deliverable-lock.ts), yang baru terisi setelah freelancer
 * menandatangani submitDeliverable. HASH_MISMATCH karena itu hanya berarti
 * satu hal: hash sudah terkunci di kontrak dan konten ini berbeda.
 */
export async function postDeliverable(jobId: number, content: string): Promise<{ hash: `0x${string}`; length: number }> {
  let rateRetried = false;
  for (;;) {
    try {
      const r = await apiPost<DeliverableRes>(`/api/jobs/${jobId}/deliverable`, { content });
      return { hash: r.deliverableHash, length: r.length };
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : undefined;
      if (code === 'RATE_LIMITED' && !rateRetried) { rateRetried = true; await wait(RATE_RETRY_MS); continue; }
      if (code === 'HASH_MISMATCH') {
        throw new Error('Konten sudah terkunci on-chain dengan hash lain. Hash yang ditandatangani tidak bisa diubah.');
      }
      throw e;
    }
  }
}

/**
 * Setelah receipt submitDeliverable: pastikan konten di server PERSIS yang
 * hash-nya baru ditandatangani. Sebelum tanda tangan, draf di server boleh
 * ditimpa siapa pun (endpoint tanpa autentikasi, dan memang tidak ada yang
 * perlu dilindungi saat itu). Sesudah receipt, server hanya menerima konten
 * yang cocok dengan hash on-chain — jadi kiriman ulang di sini selalu
 * mengembalikan konten yang benar, dan kiriman orang lain ditolak.
 */
export async function ensureDeliverable(jobId: number, content: string, signedHash: string): Promise<void> {
  const r = await postDeliverable(jobId, content);
  if (r.hash.toLowerCase() !== signedHash.toLowerCase()) {
    throw new Error('Konten di server berbeda dari yang ditandatangani');
  }
}

/** Draf yang belum diperiksa — kenyamanan per-browser, bukan penyimpanan andal. */
export const draftKey = (jobId: number) => `geo:deliv-draft:v1:${jobId}`;
