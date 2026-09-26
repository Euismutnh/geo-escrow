import { useIsMutating, useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { ChainInfo } from './chain-server';
import { isLive, type MarketFilter } from './status';
import type { ActivityEntry, Job, OracleRun } from './types';
import type { Verdict } from './verdict';

/*
 * Hook data untuk halaman baca-saja. Hanya dipanggil dari Client Component.
 *
 * `import type` dari chain-server/types dihapus saat kompilasi, jadi modul
 * ini tidak menyeret kode server ke browser.
 *
 * Bentuk respons di bawah mengikuti route yang sudah ada — TIDAK diubah:
 *   GET /api/jobs          -> { jobs, total, page, limit }   (limit maks 50)
 *   GET /api/stats         -> { asClient, asFreelancer, needJury, done }
 *   GET /api/activity      -> { activity }                    (limit maks 300, tanpa page)
 *   GET /api/oracle-log    -> { runs }  — tiap run membawa jobs: { brand } | null
 *   GET /api/chain-info    -> ChainInfo
 */

export interface JobList { jobs: Job[]; total: number; page: number; limit: number }
export interface Stats { asClient: number; asFreelancer: number; needJury: number; done: number }
export type OracleRunWithBrand = OracleRun & { jobs: { brand: string } | null };

/** Batas yang ditegakkan server — dipakai FE untuk tahu kapan daftar terpotong. */
export const LIMITS = { jobs: 50, activity: 300, oracleLog: 300 } as const;

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
}

/**
 * Alamat dinormalisasi ke huruf kecil untuk KUNCI CACHE. Server juga
 * menurunkan huruf (parseAddress), jadi tanpa ini alamat checksum dan
 * alamat huruf-kecil dari wallet yang sama akan jadi dua entri cache.
 */
const addr = (w?: string | null) => (w ? w.toLowerCase() : undefined);

export type JobsParams = { filter?: MarketFilter; wallet?: string | null; page?: number; limit?: number };

/**
 * SATU-SATUNYA tempat kunci cache & URL daftar job dibentuk. Dipakai
 * useJobs() dan hitungan tab di Pasar (useQueries) — kalau keduanya
 * membentuk sendiri, angka tab dan isi daftar bisa berasal dari cache
 * yang berbeda.
 */
export function jobsQuery(o: JobsParams = {}) {
  const params = { filter: o.filter, wallet: addr(o.wallet), page: o.page, limit: o.limit };
  return {
    queryKey: ['jobs', params] as const,
    queryFn: () => api<JobList>('/api/jobs' + qs(params)),
  };
}

export function useJobs(o: JobsParams = {}) {
  return useQuery({
    ...jobsQuery(o),
    // Sengaja TANPA keepPreviousData: di Pasar itu membuat kartu tab lama
    // tampil sesaat di bawah label tab baru. Kedipan kerangka lebih jujur.
  });
}

export function useStats(wallet?: string | null) {
  const w = addr(wallet);
  return useQuery({ queryKey: ['stats', w ?? null], queryFn: () => api<Stats>('/api/stats' + qs({ wallet: w })) });
}

export function useActivity(o: { jobId?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ['activity', o],
    queryFn: async () => (await api<{ activity: ActivityEntry[] }>('/api/activity' + qs(o))).activity,
  });
}

export function useOracleLog(o: { phase?: 'baseline' | 'verification'; jobId?: number; limit?: number } = {}) {
  return useQuery({
    queryKey: ['oracle-log', o],
    queryFn: async () => (await api<{ runs: OracleRunWithBrand[] }>('/api/oracle-log' + qs(o))).runs,
  });
}

/*
 *   GET /api/jobs/:id?include=runs,activity -> { job, runs, activity }
 *   GET /api/jobs/:id/verdict               -> { verdict, canonical, audit, hashes, chainEnabled }
 *                                              (404 NOT_FOUND kalau belum diverifikasi)
 */
export interface JobDetail { job: Job; runs: OracleRun[]; activity: ActivityEntry[] }

export interface VerdictAudit {
  verdict: Verdict;
  canonical: string;
  audit: {
    subsetMatches: boolean;
    recomputedSubset: number[];
    decisionMatches: boolean;
    hashMatchesStored: boolean;
    hashMatchesChain: boolean;
    allChecksPassed: boolean;
  };
  hashes: { recomputed: string; stored: string | null; onChain: string | null };
  chainEnabled: boolean;
}

/** Jeda polling halaman detail (blueprint Fase 9). */
export const POLL_MS = 4_000;

/**
 * Kunci mutasi untuk aksi yang MEMICU kerja Oracle di server (verifikasi,
 * sync/konfirmasi struktural, ukur ulang baseline). useJob() mem-polling
 * selama salah satunya berjalan: verifikasi bisa makan ~1 menit, dan status
 * `verifying` + progres per pertanyaan harus terlihat selama itu.
 */
export type OracleActionKind = 'verify' | 'sync' | 'baseline';
export const oracleActionKey = (kind: OracleActionKind, jobId: number) => ['oracle-action', kind, jobId] as const;

/**
 * Satu request untuk seluruh halaman detail. Log Oracle per job juga dari
 * sini: GET /api/jobs/:id/oracle-log memanggil getRuns() yang SAMA, jadi
 * request kedua hanya akan mengambil data yang sudah ada.
 *
 * POLLING (Fase 9, di satu tempat ini): tiap POLL_MS HANYA kalau
 *   - status job hidup (baseline_running / submitted_pending / verifying)
 *     dan prosesnya tidak macet — yang macet menunggu tombol coba-lagi,
 *     bukan ditanya terus; atau
 *   - aksi Oracle dari halaman ini sedang berjalan.
 * Job yang sudah settle = nol permintaan berulang. Tab tersembunyi juga
 * berhenti: refetchIntervalInBackground bawaan react-query = false.
 */
export function useJob(jobId: number) {
  const acting = useIsMutating({ predicate: (m) => m.options.mutationKey?.[0] === 'oracle-action' && m.options.mutationKey?.[2] === jobId }) > 0;
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: async () => {
      const r = await api<{ job: Job; runs?: OracleRun[]; activity?: ActivityEntry[] }>(`/api/jobs/${jobId}?include=runs,activity`);
      return { job: r.job, runs: r.runs ?? [], activity: r.activity ?? [] } satisfies JobDetail;
    },
    refetchInterval: (q) => {
      const job = q.state.data?.job;
      return acting || (job && isLive(job, Date.now())) ? POLL_MS : false;
    },
  });
}

/**
 * Endpoint audit. Hanya dipanggil kalau job punya verdict — tanpa itu
 * server membalas 404, dan tiap panggilan membaca kontrak lewat RPC.
 * Verdict tidak berubah setelah ada, jadi cache-nya lama.
 */
export function useVerdict(jobId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['verdict', jobId],
    queryFn: () => api<VerdictAudit>(`/api/jobs/${jobId}/verdict`),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Konfigurasi tingkat-kontrak. Server meng-cache-nya 60 detik; di sini 5 menit cukup. */
export function useChainInfo() {
  return useQuery({ queryKey: ['chain-info'], queryFn: () => api<ChainInfo>('/api/chain-info'), staleTime: 5 * 60_000 });
}
