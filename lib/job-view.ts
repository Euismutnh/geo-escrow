import { HASH_MISMATCH_ERROR } from './deliverable-lock';
import { formatTBNB, shortAddr } from './format';
import { ledgerBalance } from './ledger';
import { decide, hitPerQuery } from './scoring';
import { isStaleLock, type UiStatus } from './status';
import type { ActivityEntry, Job, OracleRun } from './types';
import { verdictHash, type Verdict } from './verdict';
import { deriveSubset, subsetSize } from './vrf';
import type { VerifyResult } from './flows/verify';

/*
 * Logika MURNI halaman detail kontrak (/jobs/[id]) — tanpa React, supaya
 * setiap cabangnya bisa diuji di scripts/check-pure.ts tanpa browser.
 * Semua aturan bisnis diimpor (hitPerQuery, decide, deriveSubset,
 * verdictHash, ledgerBalance), tidak ada yang disalin.
 */

export type Phase = 'baseline' | 'verification';

// ---------------------------------------------------------------------
// Radar sitasi — blueprint §A11
// ---------------------------------------------------------------------

export interface PhaseHits {
  /** query_index -> hit. Pertanyaan yang belum lengkap TIDAK ada di sini. */
  hits: Map<number, boolean>;
  /** Engine yang terlihat di log fase ini, urut kemunculan pertama. */
  engines: string[];
  /** Jumlah engine yang dipakai server untuk job ini (enginesFor()). */
  expected: number;
  /**
   * 'waiting'   = engine yang terlihat masih kurang → semua pertanyaan belum lengkap
   * 'ambiguous' = engine yang terlihat LEBIH banyak dari yang dipakai server
   *               (sisa provider lain) → FE tidak bisa tahu mana yang dihitung
   */
  problem: 'waiting' | 'ambiguous' | null;
}

/**
 * Hit per pertanyaan untuk satu fase, dengan aturan gabung yang SAMA
 * dengan server (hitPerQuery).
 *
 * FE tidak tahu engine mana yang aktif di server (enginesFor() membaca
 * ORACLE_PROVIDER, hanya ada di server). Jadi engineIds diambil dari log
 * — dan penjaganya: kalau multi_engine tapi baru satu engine yang terlihat,
 * hitPerQuery akan menganggap satu engine itu "lengkap" dan menampilkan
 * jawaban satu gaya sebagai hasil final. Karena itu jumlahnya dicocokkan
 * dulu dengan jumlah yang dipakai server: 1, atau 2 untuk multi_engine.
 */
export function phaseHits(
  job: Pick<Job, 'multi_engine'>,
  runs: readonly Pick<OracleRun, 'phase' | 'query_index' | 'engine' | 'hit'>[],
  phase: Phase
): PhaseHits {
  const expected = job.multi_engine ? 2 : 1;
  const rows = runs.filter((r) => r.phase === phase);
  const engines = [...new Set(rows.map((r) => r.engine))];

  if (engines.length === 0) return { hits: new Map(), engines, expected, problem: null };
  if (engines.length < expected) return { hits: new Map(), engines, expected, problem: 'waiting' };
  if (engines.length > expected) return { hits: new Map(), engines, expected, problem: 'ambiguous' };
  return { hits: hitPerQuery(rows, engines), engines, expected, problem: null };
}

// ---------------------------------------------------------------------
// Waktu & aktivitas
// ---------------------------------------------------------------------

const SETTLE_TYPES = ['final_release', 'final_refund', 'jury_release', 'jury_refund', 'reclaim'];

/** Baris aktivitas TERBARU dengan salah satu tipe itu (urutan blok, bukan urutan array). */
export function lastActivity(activity: readonly ActivityEntry[], types: readonly string[]): ActivityEntry | null {
  let best: ActivityEntry | null = null;
  for (const a of activity) {
    if (!types.includes(a.type)) continue;
    if (!best || a.block_number > best.block_number || (a.block_number === best.block_number && a.log_index > best.log_index)) best = a;
  }
  return best;
}

export interface TimeCtx {
  /** ms dari useNow(); null = belum ada jam (render server / hidrasi). */
  now: number | null;
  /** chain-info verifyTimeoutSeconds; null = belum diketahui. */
  verifyTimeoutSec: number | null;
}

/** Status Open dan batas ambil sudah lewat. Tanpa jam → false (jangan menebak). */
export function isAcceptExpired(job: Pick<Job, 'status' | 'accept_deadline'>, now: number | null): boolean {
  if (now === null || job.status !== 'Open' || !job.accept_deadline) return false;
  const t = Date.parse(job.accept_deadline);
  return Number.isFinite(t) && t <= now;
}

/**
 * Verifikasi macet melewati verifyTimeout — siapa pun boleh
 * escalateStuckJob(). Waktu mulainya dari event StructuralConfirmed
 * (aktivitas structural_release). Tanpa event itu, atau tanpa nilai
 * timeout dari kontrak, jawabannya "tidak" — lebih baik tidak menawarkan
 * aksi yang akan ditolak kontrak.
 */
export function isVerifyStuck(job: Pick<Job, 'status' | 'job_state'>, activity: readonly ActivityEntry[], t: TimeCtx): boolean {
  if (job.status !== 'Verifying' || job.job_state === 'running_verify') return false;
  if (t.now === null || t.verifyTimeoutSec === null) return false;
  const s = lastActivity(activity, ['structural_release']);
  if (!s) return false;
  const start = Date.parse(s.created_at);
  return Number.isFinite(start) && t.now - start > t.verifyTimeoutSec * 1000;
}

/** Konfirmasi struktural berhenti karena isi di server ≠ hash on-chain (bukan gangguan sistem). */
export const isHashMismatch = (job: Pick<Job, 'last_error'>) => job.last_error?.includes(HASH_MISMATCH_ERROR) ?? false;

/** Kiriman sebelumnya ditolak cek struktural dan job kembali ke Accepted. */
export function rejectedSubmission(ui: UiStatus, activity: readonly ActivityEntry[]): ActivityEntry | null {
  return ui === 'in_progress' ? lastActivity(activity, ['structural_rejected']) : null;
}

// ---------------------------------------------------------------------
// Perjalanan kontrak — 7 langkah (blueprint Fase 4)
// ---------------------------------------------------------------------

export type StepKey = 'created' | 'baseline' | 'accepted' | 'submitted' | 'structural' | 'verified' | 'settled';
export type StepState = 'done' | 'active' | 'fail' | 'skip' | 'todo';

export interface Step {
  key: StepKey;
  title: string;
  sub: string;
  state: StepState;
  /** ISO — waktu langkah itu selesai, kalau diketahui. */
  at: string | null;
  /** Hash tx on-chain, kalau langkah itu punya event. */
  tx: string | null;
  /** true = langkah on-chain; false = kerja Oracle di backend. */
  chain: boolean;
}

const STEPS: { key: StepKey; title: string; sub: string; chain: boolean }[] = [
  { key: 'created', title: 'Kontrak dibuat & dana dikunci', sub: 'Budget dikunci di kontrak', chain: true },
  { key: 'baseline', title: 'Baseline diukur Oracle', sub: 'Jawaban AI diukur sebelum optimasi', chain: false },
  { key: 'accepted', title: 'Diambil freelancer', sub: 'Freelancer mengunci bond', chain: true },
  { key: 'submitted', title: 'Hasil dikirim', sub: 'Hash konten dicatat di blockchain', chain: true },
  { key: 'structural', title: 'Cek struktural', sub: 'Sebagian budget cair jika lolos', chain: true },
  { key: 'verified', title: 'Verifikasi Oracle', sub: 'Pertanyaan acak diukur ulang', chain: false },
  { key: 'settled', title: 'Settlement', sub: 'Dana akhir dibagikan', chain: true },
];

/** [indeks langkah aktif, gagal?]. Indeks 7 = semua selesai. */
const POS: Record<UiStatus, [number, boolean]> = {
  baseline_running: [1, false],
  baseline_failed: [1, true],
  open: [2, false],
  in_progress: [3, false],
  submitted_pending: [4, false],
  structural_failed: [4, true],
  awaiting_verify: [5, false],
  verifying: [5, false],
  dispute: [6, false],
  settled_release: [7, false],
  settled_refund: [7, false],
  jury_release: [7, false],
  jury_refund: [7, false],
};

/** Budget ditarik client karena tidak ada yang mengambil (reclaimExpired). */
export const isReclaimed = (job: Pick<Job, 'status' | 'freelancer_addr'>) => job.status === 'Refunded' && !job.freelancer_addr;

function doneSub(job: Job, key: StepKey): string | null {
  const n = job.queries.length;
  switch (key) {
    case 'created': return `Budget ${formatTBNB(job.budget_wei)} dikunci`;
    case 'baseline': return job.baseline_score !== null ? `${job.baseline_score} dari ${n} pertanyaan menyebut brand` : null;
    case 'accepted': return job.freelancer_addr ? `${job.bond_wei ? `Bond ${formatTBNB(job.bond_wei)} dikunci · ` : ''}${shortAddr(job.freelancer_addr)}` : null;
    case 'submitted': return job.deliverable_hash ? 'Hash konten tercatat on-chain' : null;
    case 'structural': return job.structural_released_wei !== '0' ? `${formatTBNB(job.structural_released_wei)} cair ke freelancer` : null;
    case 'verified': return job.verification_score !== null ? `${job.verification_score} dari ${job.verification_of} pertanyaan acak menyebut brand` : null;
    case 'settled':
      if (isReclaimed(job)) return 'Budget ditarik kembali oleh client';
      return job.status === 'ReleasedFull' ? 'Sisa budget dan bond cair ke freelancer' : 'Sisa budget dan bond kembali ke client';
  }
}

export function timeline(job: Job, ui: UiStatus, activity: readonly ActivityEntry[], t: TimeCtx): { steps: Step[]; reached: number } {
  const [idx, failed] = POS[ui];
  const reclaimed = isReclaimed(job);
  const rejected = rejectedSubmission(ui, activity);
  const stuck = isVerifyStuck(job, activity, t);

  const ev = (types: string[]) => lastActivity(activity, types);
  const deposit = ev(['deposit']), bond = ev(['bond_lock']), structural = ev(['structural_release']), settle = ev(SETTLE_TYPES);
  const when: Record<StepKey, [string | null, string | null]> = {
    created: [deposit?.created_at ?? job.created_at, deposit?.tx_hash ?? null],
    baseline: [job.baseline_at, null],
    accepted: [bond?.created_at ?? null, bond?.tx_hash ?? null],
    submitted: [job.deliverable_submitted_at, null],
    structural: [structural?.created_at ?? null, structural?.tx_hash ?? null],
    verified: [job.verification_at, null],
    settled: [settle?.created_at ?? null, settle?.tx_hash ?? null],
  };

  const steps = STEPS.map((s, i): Step => {
    let state: StepState = i < idx ? 'done' : i === idx ? (failed ? 'fail' : 'active') : 'todo';
    let sub = (state === 'done' && doneSub(job, s.key)) || s.sub;

    if (reclaimed && i >= 2 && i <= 5) { state = 'skip'; sub = 'Dilewati'; }
    if (i === 1 && ui === 'baseline_running') sub = 'Oracle sedang bertanya ke AI…';
    if (i === 1 && ui === 'baseline_failed') sub = 'Gagal — bisa diukur ulang';
    if (i === 2 && ui === 'open' && isAcceptExpired(job, t.now)) sub = 'Batas ambil lewat · client bisa menarik dana';
    if (i === 3 && rejected) sub = 'Kiriman sebelumnya ditolak · menunggu kiriman ulang';
    if (i === 4 && ui === 'submitted_pending') sub = 'Oracle sedang mengonfirmasi ke kontrak…';
    if (i === 4 && ui === 'structural_failed') sub = isHashMismatch(job) ? 'Tertahan — konten di server tidak cocok dengan hash on-chain' : 'Konfirmasi gagal — gangguan sistem';
    if (i === 5 && ui === 'verifying') sub = 'Oracle bertanya ulang ke AI…';
    if (i === 5 && stuck) sub = 'Macet melewati batas waktu verifikasi';
    if (i === 6 && ui === 'dispute') sub = 'Zona abu — menunggu putusan arbiter';
    if (i === 6 && (ui === 'jury_release' || ui === 'jury_refund')) sub = 'Diputus oleh arbiter';

    const [at, tx] = state === 'done' ? when[s.key] : [null, null];
    return { key: s.key, title: s.title, sub, state, at, tx, chain: s.chain };
  });
  return { steps, reached: Math.min(idx, 7) };
}

// ---------------------------------------------------------------------
// Ledger escrow
// ---------------------------------------------------------------------

export type FundTone = 'chain' | 'signal' | 'warn' | 'verify' | 'danger' | 'faint';

const FUNDS: Record<UiStatus, [string, FundTone]> = {
  baseline_running: ['Terkunci di kontrak', 'chain'],
  baseline_failed: ['Terkunci di kontrak', 'chain'],
  open: ['Terkunci di kontrak', 'chain'],
  in_progress: ['Terkunci · bond ikut dikunci', 'chain'],
  submitted_pending: ['Terkunci · menunggu cek struktural', 'signal'],
  structural_failed: ['Terkunci · menunggu cek struktural', 'signal'],
  awaiting_verify: ['Sebagian cair · sisa terkunci', 'signal'],
  verifying: ['Sebagian cair · sisa terkunci', 'signal'],
  dispute: ['Terkunci · menunggu arbiter', 'warn'],
  settled_release: ['Cair penuh ke freelancer', 'verify'],
  jury_release: ['Cair penuh ke freelancer', 'verify'],
  settled_refund: ['Kembali ke client', 'danger'],
  jury_refund: ['Kembali ke client', 'danger'],
};

export function fundsLabel(job: Pick<Job, 'status' | 'freelancer_addr'>, ui: UiStatus): [string, FundTone] {
  return isReclaimed(job) ? ['Ditarik kembali oleh client', 'faint'] : FUNDS[ui];
}

/**
 * Dana job ini yang MASIH di kontrak, dari ledger aktivitas — bukan dari
 * kolom jobs (alasannya di lib/ledger.ts: job yang dibuat saat chain mati
 * ada di tabel jobs tapi tidak di kontrak).
 *
 * null = tidak bisa dipastikan: belum ada event on-chain sama sekali, atau
 * ada baris yang tidak bisa dihitung. Jangan ganti dengan angka tebakan.
 */
export function heldInContract(activity: readonly ActivityEntry[]): bigint | null {
  if (activity.length === 0) return null;
  const { balance, problems } = ledgerBalance(activity);
  return problems.length > 0 || balance < 0n ? null : balance;
}

// ---------------------------------------------------------------------
// Audit verdict — dihitung ulang DI BROWSER
// ---------------------------------------------------------------------

export type CheckResult = 'y' | 'n' | 's';
export interface AuditCheck { key: string; result: CheckResult; title: string; detail: string }

const ZERO_HASH = /^0x0+$/;
const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function attempt(fn: () => CheckResult): CheckResult {
  try { return fn(); } catch { return 'n'; }
}

/**
 * Lima pemeriksaan yang diulang di browser pengunjung, dari data publik.
 * Server punya pemeriksaan sendiri (GET /api/jobs/:id/verdict), tapi
 * "server bilang lolos" bukan bukti — menghitung ulang sendiri adalah bukti.
 *
 * `chain` = hash on-chain hasil getJob() yang dibaca browser lewat RPC
 * publik (Fase 5). chainEnabled false = mode pengembangan.
 */
export function auditVerdict(
  job: Job,
  verdict: Verdict,
  runs: readonly OracleRun[],
  chain: { onChain: string | null; chainEnabled: boolean } | 'loading' | 'error'
): { checks: AuditCheck[]; overall: CheckResult } {
  const checks: AuditCheck[] = [];
  const push = (key: string, title: string, result: CheckResult, detail: string) => checks.push({ key, title, result, detail });

  // 1. Subset: diturunkan ulang dari seed on-chain.
  let subset: number[] = [];
  const r1 = attempt(() => {
    subset = deriveSubset(verdict.seed as `0x${string}`, verdict.n, subsetSize(verdict.n));
    const matchesJob = !job.verification_subset || same(job.verification_subset, verdict.subset);
    return same(subset, verdict.subset) && matchesJob ? 'y' : 'n';
  });
  push('subset', 'Subset diturunkan ulang dari seed', r1,
    r1 === 'y' ? `Seed → pertanyaan #${verdict.subset.map((i) => i + 1).join(', #')}` : 'Subset di verdict tidak sama dengan hasil undian dari seed');

  // 2. Hit di verdict = log jawaban AI, dan jumlahnya = skor.
  const ph = phaseHits(job, runs, 'verification');
  const r2 = attempt(() => {
    if (verdict.hits.length !== verdict.subset.length || verdict.hits.reduce((a, b) => a + b, 0) !== verdict.score) return 'n';
    const fromLog = verdict.subset.map((qi) => ph.hits.get(qi));
    if (fromLog.some((h) => h === undefined)) return 's';
    return fromLog.every((h, i) => (h ? 1 : 0) === verdict.hits[i]) ? 'y' : 'n';
  });
  push('hits', 'Hit cocok dengan log jawaban AI', r2,
    r2 === 'y' ? `${verdict.score} dari ${verdict.of} menyebut brand${verdict.multiEngine ? ' di kedua gaya penjawab' : ''}`
      : r2 === 's' ? 'Log jawaban AI untuk subset ini tidak lengkap' : 'Hit di verdict berbeda dari log jawaban AI');

  // 3. Keputusan: aritmetika integer dari skor yang dipublikasi.
  const r3 = attempt(() => (decide({ score: verdict.score, of: verdict.of, target: verdict.target, n: verdict.n }) === verdict.decision ? 'y' : 'n'));
  push('decision', 'Keputusan dihitung ulang', r3, r3 === 'y' ? 'Aritmetika integer, tanpa pembulatan' : 'Keputusan di verdict tidak sesuai skornya');

  // 4 & 5. Hash.
  let hash = '';
  const r4 = attempt(() => {
    hash = verdictHash(verdict);
    return job.verdict_hash && hash.toLowerCase() === job.verdict_hash.toLowerCase() ? 'y' : 'n';
  });
  push('stored', 'Hash verdict cocok dengan database', r4, r4 === 'y' ? 'keccak256 dihitung di browser Anda' : 'Hash hitungan ulang berbeda dari yang tersimpan');

  let r5: CheckResult = 's';
  let d5: string;
  if (chain === 'loading') d5 = 'Membaca kontrak…';
  else if (chain === 'error') d5 = 'Kontrak tidak bisa dibaca saat ini — pemeriksaan ini dilewati';
  else if (!chain.chainEnabled) d5 = 'Blockchain nonaktif (mode pengembangan) — tidak ada hash on-chain untuk dibandingkan';
  else if (!chain.onChain || ZERO_HASH.test(chain.onChain)) { r5 = 'n'; d5 = 'Kontrak tidak menyimpan hash verdict untuk job ini'; }
  else if (!hash) d5 = 'Hash verdict tidak bisa dihitung';
  else {
    r5 = hash.toLowerCase() === chain.onChain.toLowerCase() ? 'y' : 'n';
    d5 = r5 === 'y' ? 'Dibaca browser Anda langsung dari kontrak di BSC Testnet' : 'Hash on-chain berbeda dari verdict yang dipublikasi';
  }
  push('chain', 'Hash verdict cocok dengan on-chain', r5, d5);

  const overall: CheckResult = checks.some((c) => c.result === 'n') ? 'n' : checks.every((c) => c.result === 'y') ? 'y' : 's';
  return { checks, overall };
}

/** Rumus keputusan dalam angka, untuk ditampilkan (identik dengan decide()). */
export function decisionMath(v: Pick<Verdict, 'score' | 'of' | 'target' | 'n'>) {
  const lhs = v.score * v.n, rhs = v.target * v.of, floor = rhs - 2 * v.n;
  return { lhs, rhs, floor };
}

// ---------------------------------------------------------------------
// Aksi yang memicu kerja Oracle (Fase 8) — keputusan murni, diuji di check-pure
// ---------------------------------------------------------------------

/** Aksi Oracle yang bisa dipicu dari halaman detail. Path-nya di components/job/OracleActions.tsx. */
export type OracleAction = 'verify' | 'sync' | 'baseline';

export interface OracleOffer {
  kind: OracleAction;
  label: string;
  /** Kalimat penjelas di atas tombol; null = tombol cukup menjelaskan dirinya. */
  why: string | null;
}

/**
 * Setelah submitDeliverable, POST /api/sync/:id memicu konfirmasi dalam
 * hitungan detik. Masih idle lewat dari ini = pemicunya tidak pernah
 * sampai (tab ditutup, after() terpotong) → tawarkan konfirmasi ulang.
 */
export const CONFIRM_GRACE_MS = 2 * 60_000;

/**
 * Tombol Oracle apa yang ditawarkan untuk keadaan job ini — atau null.
 *
 * Yang macet (lock > STALE_LOCK_MS) ditawari coba-lagi: server mengambil
 * alih lock-nya (acquireLock), jadi tombolnya benar-benar bekerja tanpa
 * menunggu cron. Konten yang tidak cocok dengan hash on-chain TIDAK
 * ditawari: mengulang konfirmasi pasti gagal lagi — yang dibutuhkan
 * adalah kiriman ulang konten yang ditandatangani.
 */
export function oracleOffer(job: Job, ui: UiStatus, now: number | null): OracleOffer | null {
  const stale = isStaleLock(job, now);
  switch (ui) {
    case 'baseline_failed':
      return { kind: 'baseline', label: 'Ukur ulang baseline', why: null };
    case 'baseline_running':
      return stale ? { kind: 'baseline', label: 'Ukur ulang baseline', why: 'Pengukuran baseline berhenti di tengah jalan — lebih dari 3 menit tanpa kemajuan.' } : null;
    case 'submitted_pending': {
      if (stale) return { kind: 'sync', label: 'Konfirmasi ulang', why: 'Konfirmasi struktural berhenti di tengah jalan — lebih dari 3 menit tanpa kemajuan.' };
      if (job.job_state !== 'idle' || now === null) return null;
      const since = Date.parse(job.deliverable_submitted_at ?? job.job_state_at);
      return Number.isFinite(since) && now - since > CONFIRM_GRACE_MS
        ? { kind: 'sync', label: 'Konfirmasi ulang', why: 'Konfirmasi struktural belum juga dimulai. Hash konten sudah aman di blockchain.' }
        : null;
    }
    case 'structural_failed':
      return isHashMismatch(job) ? null : { kind: 'sync', label: 'Coba konfirmasi lagi', why: null };
    case 'awaiting_verify':
      return job.job_state === 'error'
        ? { kind: 'verify', label: 'Coba verifikasi lagi', why: null }
        : { kind: 'verify', label: 'Verifikasi sekarang', why: null };
    case 'verifying':
      return stale ? { kind: 'verify', label: 'Lanjutkan verifikasi', why: 'Verifikasi berhenti di tengah jalan — lebih dari 3 menit tanpa kemajuan. Melanjutkan tidak mengulang pembayaran: status kontrak diperiksa dulu.' } : null;
    default:
      return null;
  }
}

/** Kalimat hasil POST /api/jobs/:id/verify. */
export function verifyOutcome(r: Pick<VerifyResult, 'score' | 'of' | 'decision' | 'settledOnChain' | 'alreadySettled' | 'resumedSettlement'>): { tone: 'ok' | 'warn'; text: string } {
  const skor = `Skor ${r.score} dari ${r.of} pertanyaan acak`;
  const base =
    r.decision === 'release' ? `${skor} — target tercapai. Sisa budget + bond cair ke freelancer.`
    : r.decision === 'refund' ? `${skor} — target tidak tercapai. Sisa budget + bond kembali ke client.`
    : `${skor} jatuh di zona abu — keputusan diteruskan ke arbiter.`;
  const notes: string[] = [];
  if (r.resumedSettlement) notes.push('Verdict yang sama dipakai ulang; hanya settlement yang dilanjutkan.');
  if (r.alreadySettled) notes.push('Settlement sudah terjadi sebelumnya — tidak ada transaksi baru.');
  if (!r.settledOnChain) notes.push('Mode pengembangan: tidak ada transaksi on-chain.');
  return { tone: r.decision === 'dispute' ? 'warn' : 'ok', text: [base, ...notes].join(' ') };
}
