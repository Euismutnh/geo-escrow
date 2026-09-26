/**
 * Verifikasi lapisan murni: types/hash/vrf/scoring/verdict/format/status
 * (Fase 2) + verifyCronSecret dari validate.ts (Fase 5).
 * Jalankan: npm run check
 */
import { decide, hitPerQuery, type RunHit } from '../lib/scoring';
import { parseJobIdParam, firstParam, parsePageParam, MAX_PAGE } from '../lib/route-params';
import { api, apiPost, ApiClientError } from '../lib/api';
import { subsetSize, deriveSubset, effectiveSeedV2 } from '../lib/vrf';
import { queryPoolHash, canonicalQueryPool, contentHash } from '../lib/hash';
import { canonicalVerdict, recomputeSubset, verdictHash, type Verdict, type VerdictV2 } from '../lib/verdict';
import { formatTBNB, formatTBNBShort, toWei, shortAddr, formatTime, formatRelative } from '../lib/format';
import { ledgerBalance, ledgerSeries, LEDGER_IN, LEDGER_OUT, LEDGER_NEUTRAL, type LedgerRow } from '../lib/ledger';
import { readFileSync } from 'node:fs';
import { deriveUiStatus, isLive, isStaleLock, POLL_FAST_MS, POLL_SLOW_MS, pollIntervalFor, STALE_LOCK_MS, UI_STATUS_META, type UiStatus, type UiStatusInput } from '../lib/status';
import type { VerifyResult } from '../lib/flows/verify';
import { verifyCronSecret, parseJobId } from '../lib/validate';
import { ApiError, internalError, publicErrorMessage } from '../lib/http';
import { OracleError } from '../lib/oracle/types';
import {
  auditVerdict, CONFIRM_GRACE_MS, confirmTxValid, decisionMath, fundsLabel, heldInContract, isAcceptExpired, isHashMismatch, isVerifyStuck, oracleOffer, targetNotAboveBaseline, verifyOutcome,
  lastActivity, phaseHits, rejectedSubmission, timeline, type TimeCtx,
} from '../lib/job-view';
import type { ActivityEntry, Job } from '../lib/types';
import {
  BaseError, ContractFunctionExecutionError, ContractFunctionRevertedError, InsufficientFundsError,
  UserRejectedRequestError, WaitForTransactionReceiptTimeoutError,
} from 'viem';
import { geoEscrowAbi } from '../lib/abi';
import {
  chainName, classifyTxError, isBusy, isUserRejection, pickConnectors, relationToJob, sameAddr,
  stepIndex, syncDecision, TX_MSG,
} from '../lib/tx';
import { lockedFor, receivedBy } from '../lib/ledger';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, toHex, type Log } from 'viem';
import { checkDraft, FIELD_LABEL, FIELD_ORDER, firstInvalid, LIMITS, MIN_BUDGET_WEI, parseBudgetTbnb, parseQueries, toLocalInput, type Draft } from '../lib/job-input';
import { jobIdFromReceipt, makeSnapshot, metadataBody, parsePending, parsePendingAll, saveJobMetadata } from '../lib/create-job';
import { requireFutureDate, requireJobId, requireQueryPool, requireText, requireWei } from '../lib/validate-input';
import { requireAddress } from '../lib/validate';
import { acceptGuard, postDeliverable, submitGuard } from '../lib/deliverable';
import { checkStructural } from '../lib/structural';
import { contentAllowed, HASH_MISMATCH_ERROR, isEmptyHash, lockedDeliverableHash, SIGNED_CONTENT_GRACE_MS, SIGNED_CONTENT_MISSING_REASON, signedContentGraceExpired } from '../lib/deliverable-lock';
import { aktivitasWajib, keBarisActivity, settledByDari, type LogTerurai } from '../lib/indexer';
import { checkNewArbiter } from '../lib/admin';
import { env } from '../lib/env';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
}
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  check(name, g === w, `dapat ${g}, ingin ${w}`);
}
function throws(name: string, fn: () => unknown) {
  try { fn(); check(name, false, 'tidak melempar error'); }
  catch { check(name, true); }
}
const section = (s: string) => console.log(`\n${s}`);

// ---------------------------------------------------------
section('scoring.decide - tabel batas dari blueprint (target 3/5, subset 4)');
const d = (score: number) => decide({ score, of: 4, target: 3, n: 5 });
eq('score 0 -> refund', d(0), 'refund');
eq('score 1 -> dispute', d(1), 'dispute');
eq('score 2 -> dispute', d(2), 'dispute');
eq('score 3 -> release', d(3), 'release');
eq('score 4 -> release', d(4), 'release');

// ---------------------------------------------------------
section('scoring.decide - setara dengan rumus float prototipe (exhaustive)');
// Rumus asli dari geo-escrow-demo-neobrutalism.html
function decidePrototype(score: number, of: number, target: number, n: number) {
  const scaled = (target / n) * of;
  if (score >= Math.ceil(scaled - 0.001)) return 'release';
  if (score <= scaled - 2) return 'refund';
  return 'dispute';
}
let compared = 0;
const mismatches: string[] = [];
for (let n = 3; n <= 6; n++) {
  for (let target = 1; target <= n; target++) {
    for (let of = 3; of <= n; of++) {
      for (let score = 0; score <= of; score++) {
        compared++;
        const a = decide({ score, of, target, n });
        const b = decidePrototype(score, of, target, n);
        if (a !== b) {
          mismatches.push(`n=${n} target=${target} of=${of} score=${score}: integer=${a} float=${b}`);
        }
      }
    }
  }
}
check(`${compared} kombinasi identik dengan prototipe`, mismatches.length === 0,
  mismatches.slice(0, 5).join(' | '));

// ---------------------------------------------------------
section('vrf');
eq('subsetSize(3)', subsetSize(3), 3);
eq('subsetSize(4)', subsetSize(4), 3);
eq('subsetSize(5)', subsetSize(5), 4);
eq('subsetSize(6)', subsetSize(6), 5);

const seedA = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const seedB = ('0x' + 'cd'.repeat(32)) as `0x${string}`;
const sA1 = deriveSubset(seedA, 5, 4);
const sA2 = deriveSubset(seedA, 5, 4);
const sB = deriveSubset(seedB, 5, 4);
eq('deterministik untuk seed sama', sA1, sA2);
check('seed beda -> subset beda', JSON.stringify(sA1) !== JSON.stringify(sB),
  `keduanya ${JSON.stringify(sA1)}`);
eq('panjang = k', sA1.length, 4);
eq('terurut naik', sA1, [...sA1].sort((a, b) => a - b));
eq('tanpa duplikat', new Set(sA1).size, sA1.length);
check('semua indeks dalam rentang 0..n-1', sA1.every((i) => i >= 0 && i < 5));
eq('n=3,k=3 -> seluruh pool', deriveSubset(seedA, 3, 3), [0, 1, 2]);
eq('n=0 -> kosong', deriveSubset(seedA, 0, 3), []);

// sebaran: tiap indeks harus pernah terpilih di 200 seed berbeda
const seen = new Set<number>();
for (let i = 0; i < 200; i++) {
  const s = ('0x' + i.toString(16).padStart(64, '0')) as `0x${string}`;
  deriveSubset(s, 5, 3).forEach((x) => seen.add(x));
}
eq('200 seed menjangkau semua indeks', [...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4]);

// ---------------------------------------------------------
section('hash - stabilitas & kepekaan');
const base = {
  brand: 'Root & Bloom',
  queries: [
    'Apa rekomendasi skincare organik?',
    'Brand lokal apa yang alami?',
    'Serum organik lokal?',
  ],
  targetCount: 2,
  multiEngine: false,
};
const h = queryPoolHash(base);
eq('stabil untuk input identik', queryPoolHash({ ...base }), h);
eq('spasi di ujung diabaikan (trim)', queryPoolHash({ ...base, brand: '  Root & Bloom  ' }), h);
check('peka: brand', queryPoolHash({ ...base, brand: 'Lain' }) !== h);
check('peka: targetCount', queryPoolHash({ ...base, targetCount: 3 }) !== h);
check('peka: multiEngine', queryPoolHash({ ...base, multiEngine: true }) !== h);
check('peka: urutan queries',
  queryPoolHash({ ...base, queries: [base.queries[1], base.queries[0], base.queries[2]] }) !== h);
check('peka: isi query',
  queryPoolHash({ ...base, queries: [...base.queries.slice(0, 2), 'beda'] }) !== h);
check('format keccak256 (0x + 64 hex)', /^0x[0-9a-f]{64}$/.test(h), h);
check('contentHash berbeda untuk isi berbeda', contentHash('a') !== contentHash('b'));

section('hash - penjaga kanonikalisasi (keamanan)');
throws('tolak newline di brand', () => queryPoolHash({ ...base, brand: 'Acme\n3\n0' }));
throws('tolak newline di query', () => queryPoolHash({ ...base, queries: ['a\nb', 'c', 'd'] }));
throws('tolak carriage return di tengah brand', () => queryPoolHash({ ...base, brand: 'Ac\rme' }));
throws('tolak tab-newline di tengah query', () => queryPoolHash({ ...base, queries: ['a', 'b\nc', 'd'] }));
// CR/spasi di UJUNG sengaja dinormalkan oleh trim(), sama seperti spasi biasa.
eq('CR di ujung dinormalkan trim', queryPoolHash({ ...base, brand: 'Root & Bloom\r' }), h);
throws('tolak brand kosong', () => queryPoolHash({ ...base, brand: '   ' }));
check('canonical memuat penanda versi', canonicalQueryPool(base).startsWith('GEOv1\n'));

// ---------------------------------------------------------
section('verdict');
const verdict: Verdict = {
  v: 'GEOv1', jobId: 1, brand: 'Root & Bloom',
  seed: seedA, subset: [0, 2, 4], hits: [1, 0, 1],
  score: 2, of: 3, target: 2, n: 5, multiEngine: false, decision: 'release',
};
const vh = verdictHash(verdict);
eq('stabil', verdictHash({ ...verdict }), vh);
check('peka: score', verdictHash({ ...verdict, score: 3 }) !== vh);
check('peka: subset', verdictHash({ ...verdict, subset: [1, 2, 4] }) !== vh);
check('peka: hits', verdictHash({ ...verdict, hits: [1, 1, 1] }) !== vh);
check('peka: decision', verdictHash({ ...verdict, decision: 'refund' }) !== vh);
check('peka: seed', verdictHash({ ...verdict, seed: seedB }) !== vh);
check('format keccak256', /^0x[0-9a-f]{64}$/.test(vh), vh);

// ---------------------------------------------------------
section('format - presisi wei');
eq('0.02 tBNB', formatTBNB('20000000000000000'), '0.02 tBNB');
eq('0', formatTBNB('0'), '0 tBNB');
eq('1', formatTBNB('1000000000000000000'), '1 tBNB');
eq('10 (nol di belakang tidak terpangkas)', formatTBNB('10000000000000000000'), '10 tBNB');
eq('1 wei', formatTBNB('1'), '0.000000000000000001 tBNB');
eq('toWei 0.02', toWei('0.02'), '20000000000000000');
eq('toWei -> string', typeof toWei(0.03), 'string');
eq('bolak-balik presisi utuh', toWei('0.123456789012345678'), '123456789012345678');
eq('shortAddr', shortAddr('0x71c7656ec7ab88b098defb751b7401b5f6d8976f'), '0x71c7…976f');
eq('shortAddr null', shortAddr(null), '');

// ---------------------------------------------------------
section('status - 13 status UI');
const j = (o: Partial<UiStatusInput>): UiStatus => deriveUiStatus({
  status: 'Open', job_state: 'idle', baseline_score: null, settled_by: null, ...o,
});

eq('Open + belum baseline', j({}), 'baseline_running');
eq('Open + baseline error', j({ job_state: 'error' }), 'baseline_failed');
eq('Open + sudah baseline', j({ baseline_score: 3 }), 'open');
eq('Accepted', j({ status: 'Accepted' }), 'in_progress');
eq('Submitted', j({ status: 'Submitted' }), 'submitted_pending');
eq('Submitted + error', j({ status: 'Submitted', job_state: 'error' }), 'structural_failed');
eq('Verifying idle', j({ status: 'Verifying' }), 'awaiting_verify');
eq('Verifying berjalan', j({ status: 'Verifying', job_state: 'running_verify' }), 'verifying');
eq('Verifying error -> bisa coba lagi', j({ status: 'Verifying', job_state: 'error' }), 'awaiting_verify');
eq('Disputed', j({ status: 'Disputed' }), 'dispute');
eq('ReleasedFull oleh oracle', j({ status: 'ReleasedFull', settled_by: 'oracle' }), 'settled_release');
eq('ReleasedFull oleh juri', j({ status: 'ReleasedFull', settled_by: 'arbiter' }), 'jury_release');
eq('Refunded oleh oracle', j({ status: 'Refunded', settled_by: 'oracle' }), 'settled_refund');
eq('Refunded oleh juri', j({ status: 'Refunded', settled_by: 'arbiter' }), 'jury_refund');

const allUi = Object.keys(UI_STATUS_META) as UiStatus[];
check('tiap status UI punya label & warna',
  allUi.every((s) => UI_STATUS_META[s].label && UI_STATUS_META[s].cls));
check('status gagal tidak pernah menampilkan spinner',
  !UI_STATUS_META.baseline_failed.spin && !UI_STATUS_META.structural_failed.spin);

// ---------------------------------------------------------
section('verifyCronSecret - penjaga endpoint internal');
{
  const saved = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'rahasia-uji';

  check('secret benar', verifyCronSecret('Bearer rahasia-uji'));
  check('skema huruf kecil (RFC 7235: tidak peka kapital)', verifyCronSecret('bearer rahasia-uji'));

  // Kasus yang dulu GAGAL, dan sangat membingungkan: pesan penolakannya
  // identik dengan "kamu memang tidak berwenang", padahal secretnya benar.
  // Sumbernya bisa sesederhana variabel klien REST yang tidak ter-trim.
  check('spasi ekstra setelah Bearer', verifyCronSecret('Bearer  rahasia-uji'));
  check('spasi di akhir', verifyCronSecret('Bearer rahasia-uji  '));
  check('spasi di awal header', verifyCronSecret('  Bearer rahasia-uji'));

  check('secret salah ditolak', !verifyCronSecret('Bearer salah'));
  check('tanpa skema Bearer ditolak', !verifyCronSecret('rahasia-uji'));
  check('skema lain ditolak', !verifyCronSecret('Basic rahasia-uji'));
  check('header kosong ditolak', !verifyCronSecret(''));
  check('header null ditolak', !verifyCronSecret(null));
  check('Bearer tanpa token ditolak', !verifyCronSecret('Bearer '));

  // CRON_SECRET kosong harus MENUTUP endpoint internal, bukan membukanya.
  process.env.CRON_SECRET = '';
  check('CRON_SECRET kosong -> semua ditolak', !verifyCronSecret('Bearer apa pun'));

  process.env.CRON_SECRET = saved;
}

// ---------------------------------------------------------
// ---------------------------------------------------------
section('route-params.parseJobIdParam + validate.parseJobId - satu aturan untuk FE & BE');
{
  const valid: [string, number][] = [['0', 0], ['7', 7], ['42', 42], ['9007199254740991', 9007199254740991]];
  for (const [raw, want] of valid) {
    eq(`"${raw}" -> ${want}`, parseJobIdParam(raw), want);
    eq(`parseJobId("${raw}") -> ${want}`, parseJobId(raw), want);
  }
  // Semua ini DITERIMA oleh aturan lama Number(raw) + isInteger (kecuali
  // "", "abc", "-1") — dan beberapa diam-diam memetakan ke job LAIN.
  const invalid = ['', 'abc', '-1', '+1', ' 1', '1 ', '1.0', '1.5', '1e1', '0x10', '007', '01',
    '9007199254740992', '9007199254740993', '1_000', '１'];
  for (const raw of invalid) {
    eq(`${JSON.stringify(raw)} -> null`, parseJobIdParam(raw), null);
    throws(`parseJobId(${JSON.stringify(raw)}) melempar`, () => parseJobId(raw));
  }
  eq('null -> null', parseJobIdParam(null), null);
  eq('undefined -> null', parseJobIdParam(undefined), null);
  // penjaga §A9: nol adalah id SAH, bukan "tidak ada"
  check('"0" menghasilkan 0, bukan null', parseJobIdParam('0') === 0);

  // searchParams Next.js 16 bisa string, array, atau undefined
  eq('firstParam(string)', firstParam('open'), 'open');
  eq('firstParam(array) -> yang pertama', firstParam(['open', 'done']), 'open');
  eq('firstParam(undefined)', firstParam(undefined), undefined);
  eq('halaman: kosong -> 1', parsePageParam(undefined), 1);
  eq('halaman: "3" -> 3', parsePageParam('3'), 3);
  eq('halaman: "0" -> 1 (halaman dimulai dari 1)', parsePageParam('0'), 1);
  eq('halaman: "-2" / "abc" / "1.5" -> 1', [parsePageParam('-2'), parsePageParam('abc'), parsePageParam('1.5')], [1, 1, 1]);
  eq('halaman: di atas batas server diklem', parsePageParam('99999999'), MAX_PAGE);
}

// ---------------------------------------------------------
section('scoring.hitPerQuery - aturan gabung multi-engine');
{
  const A = 'claude-ringkas', B = 'claude-naratif';
  const r = (query_index: number, engine: string, hit: boolean): RunHit => ({ query_index, engine, hit });
  const toObj = (m: Map<number, boolean>) => Object.fromEntries([...m].sort((x, y) => x[0] - y[0]));

  eq('1 engine: hasilnya = engine itu', toObj(hitPerQuery([r(0, A, true), r(1, A, false)], [A])), { 0: true, 1: false });
  eq('2 engine: dua-duanya hit -> hit', toObj(hitPerQuery([r(0, A, true), r(0, B, true)], [A, B])), { 0: true });
  eq('2 engine: satu miss -> TIDAK hit', toObj(hitPerQuery([r(0, A, true), r(0, B, false)], [A, B])), { 0: false });
  eq('2 engine: baru satu menjawab -> belum ada hasil', toObj(hitPerQuery([r(0, A, true)], [A, B])), {});
  eq('engine di luar daftar diabaikan', toObj(hitPerQuery([r(0, 'mock-a', false), r(0, A, true)], [A])), { 0: true });
  eq('tanpa baris -> kosong', toObj(hitPerQuery([], [A, B])), {});
  throws('engineIds kosong melempar', () => hitPerQuery([r(0, A, true)], []));

  // Setara PERSIS dengan aturan lama di lib/oracle/runner.ts (exhaustive).
  // Aturan lama: untuk tiap indeks, ambil hasil tiap engine aktif; kalau ada
  // yang undefined -> tidak lengkap; kalau lengkap -> every(Boolean).
  function runnerLama(results: Map<string, boolean>, engineIds: string[], indices: number[]) {
    const out = new Map<number, boolean | 'tidak-lengkap'>();
    for (const i of indices) {
      const per = engineIds.map((e) => results.get(`${i}:${e}`));
      out.set(i, per.some((v) => v === undefined) ? 'tidak-lengkap' : per.every(Boolean));
    }
    return out;
  }
  const STATES = [undefined, true, false] as const;
  const mismatch: string[] = [];
  let combos = 0;
  for (const engineIds of [[A], [A, B]]) {
    const slots = 3 * engineIds.length;               // 3 pertanyaan x jumlah engine
    const total = 3 ** slots;
    for (let k = 0; k < total; k++) {
      const results = new Map<string, boolean>();
      const runs: RunHit[] = [r(1, 'mock-b', true)];  // baris sisa provider lain di setiap kombinasi
      let x = k;
      for (let q = 0; q < 3; q++) for (const e of engineIds) {
        const st = STATES[x % 3]; x = Math.floor(x / 3);
        if (st !== undefined) { results.set(`${q}:${e}`, st); runs.push(r(q, e, st)); }
      }
      const lama = runnerLama(results, engineIds, [0, 1, 2]);
      const baru = hitPerQuery(runs, engineIds);
      for (const [i, v] of lama) {
        const b = baru.has(i) ? baru.get(i) : 'tidak-lengkap';
        if (b !== v) mismatch.push(`engine=${engineIds.length} kombinasi=${k} q${i}: lama=${v} baru=${b}`);
      }
      combos++;
    }
  }
  check(`identik dengan aturan lama runner di ${combos} kombinasi`, mismatch.length === 0, mismatch.slice(0, 3).join('; '));
}

// ---------------------------------------------------------
section('format - tanggal tidak valid tidak boleh jadi "Invalid Date"');
{
  for (const v of ['bukan-tanggal', '', NaN] as never[]) eq(`formatTime(${JSON.stringify(v)}) -> ''`, formatTime(v), '');
  check('formatTime tanggal sah tidak kosong', formatTime('2026-09-24T10:00:00Z').length > 0);
  const now = Date.parse('2026-09-24T12:00:00Z'), M = 60_000, H = 60 * M, D = 24 * H;
  eq('relatif: 20 detik lalu -> baru saja', formatRelative(now - 20_000, now), 'baru saja');
  eq('relatif: 5 menit lalu', formatRelative(now - 5 * M, now), '5 menit lalu');
  eq('relatif: 2 jam lalu', formatRelative(now - 2 * H, now), '2 jam lalu');
  eq('relatif: 3 hari lalu', formatRelative(now - 3 * D, now), '3 hari lalu');
  eq('relatif: masa depan', formatRelative(now + 2 * D, now), 'dalam 2 hari');
  eq('relatif: tidak valid -> kosong', formatRelative('rusak', now), '');
}

// ---------------------------------------------------------
section('ledger - saldo escrow dari aktivitas');
{
  const T = (h: number) => new Date(Date.parse('2026-09-01T00:00:00Z') + h * 3_600_000).toISOString();
  const row = (type: string, wei: string | null, h: number): LedgerRow => ({ type, amount_wei: wei, created_at: T(h) });
  // Satu job lengkap sampai cair, persis seperti GeoEscrow._settle memancarkannya:
  // Settled.amount = sisa budget + bond (800 + 50) dalam SATU transfer, lalu
  // BondSettled(50) sebagai rincian. Model lama (final 800 + bond 50) salah.
  const selesai = [row('deposit', '1000', 0), row('bond_lock', '50', 1), row('structural_release', '200', 2),
    row('dispute_raised', null, 3), row('final_release', '850', 4), row('bond_return', '50', 4)];
  eq('job selesai impas 0', ledgerBalance(selesai).balance.toString(), '0');
  eq('tanpa masalah', ledgerBalance(selesai).problems, []);
  eq('saldo di tengah jalan (jam 2)', ledgerBalance(selesai, Date.parse(T(2))).balance.toString(), '850');
  // refund: sisa + bond ke client, bond_slash hanya rincian
  const refund = [row('deposit', '1000', 0), row('bond_lock', '50', 1), row('structural_release', '200', 2),
    row('final_refund', '850', 3), row('bond_slash', '50', 3)];
  eq('refund impas 0 (bond_slash tidak dihitung dua kali)', ledgerBalance(refund).balance.toString(), '0');
  eq('reclaim mengosongkan', ledgerBalance([row('deposit', '1000', 0), row('reclaim', '1000', 9)]).balance.toString(), '0');
  const aneh = ledgerBalance([row('deposit', '1000', 0), row('tipe_baru', '5', 1), row('bond_lock', null, 2)]);
  eq('tipe tak dikenal & jumlah kosong dilaporkan', aneh.problems.length, 2);
  eq('seri: titik pertama & terakhir', ledgerSeries(selesai, Date.parse(T(0)), Date.parse(T(4)), 5).map(String), ['1000', '1050', '850', '850', '0']);
  throws('seri butuh minimal 2 titik', () => ledgerSeries(selesai, 0, 1, 1));

  // PAGAR ANTI-PENYIMPANGAN: union ActivityType di lib/indexer.ts dibaca apa adanya.
  const src = readFileSync(new URL('../lib/indexer.ts', import.meta.url), 'utf8');
  const union = src.match(/type ActivityType =([\s\S]*?);/);
  const dariIndexer = union ? [...union[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort() : [];
  const diLedger = [...LEDGER_IN, ...LEDGER_OUT, ...LEDGER_NEUTRAL].sort();
  check('union ActivityType terbaca dari lib/indexer.ts', dariIndexer.length > 0);
  eq('setiap tipe indexer terklasifikasi, tidak kurang tidak lebih', diLedger, dariIndexer);
  check('tidak ada tipe di dua daftar sekaligus', new Set(diLedger).size === diLedger.length);
}

// ---------------------------------------------------------
section('http - pesan error mentah tidak sampai ke publik');
{
  // Contoh nyata bentuk pesan yang bocor: PostgREST menyebut nama kolom,
  // viem menyertakan URL RPC lengkap beserta kuncinya dan isi request.
  const RAHASIA = 'KUNCI_RPC_RAHASIA_123';
  const pg = { message: 'column jobs.client_addrx does not exist', code: '42703' };
  const viem = new Error(`HTTP request failed.\n\nURL: https://bsc.example/v1/${RAHASIA}\nRequest body: {"method":"eth_sendRawTransaction"}`);

  const realError = console.error;
  const tercatat: unknown[][] = [];
  console.error = (...a: unknown[]) => { tercatat.push(a); };
  try {
    const ie = internalError('memuat job', pg);
    check('internalError -> ApiError INTERNAL', ie instanceof ApiError && ie.code === 'INTERNAL');
    eq('internalError: pesan umum buatan kita', ie.message, 'Gagal memuat job');
    check('internalError: error asli disimpan di cause', ie.cause === pg);
    check('internalError: error asli dicatat di log server', tercatat.some((a) => a.includes(pg)));

    const fb = 'Kesalahan sistem';
    eq('publicErrorMessage: ApiError diteruskan', publicErrorMessage(new ApiError('WRONG_STATUS', 'Job belum Submitted'), fb), 'Job belum Submitted');
    eq('publicErrorMessage: OracleError diteruskan', publicErrorMessage(new OracleError('Kena rate limit Anthropic', true), fb), 'Kena rate limit Anthropic');
    eq('publicErrorMessage: Error viem disembunyikan', publicErrorMessage(viem, fb), fb);
    eq('publicErrorMessage: objek error Supabase disembunyikan', publicErrorMessage(pg, fb), fb);
    eq('publicErrorMessage: string mentah disembunyikan', publicErrorMessage(`gagal: ${RAHASIA}`, fb), fb);
    eq('publicErrorMessage: undefined -> fallback', publicErrorMessage(undefined, fb), fb);
    eq('publicErrorMessage: ApiError dari internalError tetap umum', publicErrorMessage(internalError('menyimpan job', viem), fb), 'Gagal menyimpan job');
    check('publicErrorMessage: yang disembunyikan tetap dicatat', tercatat.some((a) => a.includes(viem)));
  } finally {
    console.error = realError;
  }
}

// ---------------------------------------------------------
section('job-view - radar: penjaga multi_engine (§A11)');
{
  const run = (phase: 'baseline' | 'verification', q: number, engine: string, hit: boolean) => ({ phase, query_index: q, engine, hit });
  const multi = { multi_engine: true }, single = { multi_engine: false };

  // multi_engine, baru SATU gaya yang menjawab: hitPerQuery sendirian akan
  // menganggapnya lengkap. Penjaga harus menahan semuanya.
  const satu = phaseHits(multi, [run('baseline', 0, 'claude-ringkas', true), run('baseline', 1, 'claude-ringkas', false)], 'baseline');
  eq('multi + 1 engine -> tidak ada hasil per pertanyaan', satu.hits.size, 0);
  eq('multi + 1 engine -> masalah "waiting"', satu.problem, 'waiting');

  const dua = phaseHits(multi, [
    run('baseline', 0, 'claude-ringkas', true), run('baseline', 0, 'claude-naratif', false),
    run('baseline', 1, 'claude-ringkas', true), run('baseline', 1, 'claude-naratif', true),
    run('baseline', 2, 'claude-ringkas', true),
  ], 'baseline');
  eq('multi + 2 engine: satu hit satu miss -> MISS', dua.hits.get(0), false);
  eq('multi + 2 engine: dua-duanya hit -> hit', dua.hits.get(1), true);
  eq('multi + 2 engine: baru satu gaya di #2 -> belum diketahui', dua.hits.has(2), false);
  eq('multi + 2 engine -> tanpa masalah', dua.problem, null);

  eq('single + 1 engine -> dipakai apa adanya', [...phaseHits(single, [run('baseline', 0, 'mock-a', true)], 'baseline').hits], [[0, true]]);
  eq('single + 2 engine (sisa provider lain) -> "ambiguous", kosong',
    [phaseHits(single, [run('baseline', 0, 'mock-a', true), run('baseline', 0, 'claude-ringkas', false)], 'baseline')].map((p) => [p.problem, p.hits.size]), [['ambiguous', 0]]);
  eq('fase lain tidak ikut terhitung', phaseHits(single, [run('verification', 0, 'mock-a', true)], 'baseline').hits.size, 0);
  eq('tanpa log -> kosong, bukan masalah', phaseHits(multi, [], 'verification').problem, null);
}

section('job-view - perjalanan kontrak (13 status UI)');
{
  const base: Job = {
    job_id: 7, client_addr: '0xc1', freelancer_addr: null, brand: 'Kopi Rasa', brief: null, queries: ['a', 'b', 'c', 'd', 'e'],
    target_count: 3, multi_engine: false, query_pool_hash: '0x', budget_wei: '10000000000000000', bond_wei: null, structural_released_wei: '0',
    deliverable_content: null, deliverable_hash: null, deliverable_submitted_at: null, baseline_score: null, baseline_of: null, baseline_at: null,
    verification_seed: null, verification_subset: null, verification_score: null, verification_of: null, verification_decision: null,
    verification_at: null, verdict_hash: null, verdict_json: null, status: 'Open', job_state: 'queued_baseline', job_state_at: '2026-09-01T00:00:00Z',
    settled_by: null, last_error: null, accept_deadline: '2026-09-10T00:00:00Z', created_at: '2026-09-01T00:00:00Z', updated_at: '2026-09-01T00:00:00Z',
  };
  const act = (type: string, block: number, created_at = '2026-09-02T00:00:00Z', note: string | null = null): ActivityEntry => ({
    id: `${type}${block}`, job_id: 7, tx_hash: `0x${String(block).padStart(64, '0')}`, log_index: 0, block_number: block, type,
    amount_wei: null, from_addr: null, to_addr: null, note, created_at,
  });
  const T: TimeCtx = { now: Date.parse('2026-09-05T00:00:00Z'), verifyTimeoutSec: 7 * 86400 };
  const states = (j: Job, a: ActivityEntry[] = [], t = T) => timeline(j, deriveUiStatus(j), a, t).steps.map((s) => s.state[0]).join('');

  // d=done a=active f=fail s=skip t=todo
  const cases: [UiStatus, Partial<Job>, string, number][] = [
    ['baseline_running', {}, 'dattttt', 1],
    ['baseline_failed', { job_state: 'error' }, 'dfttttt', 1],
    ['open', { job_state: 'idle', baseline_score: 1 }, 'ddatttt', 2],
    ['in_progress', { status: 'Accepted', baseline_score: 1, freelancer_addr: '0xf1' }, 'dddattt', 3],
    ['submitted_pending', { status: 'Submitted', job_state: 'running_structural', baseline_score: 1 }, 'ddddatt', 4],
    ['structural_failed', { status: 'Submitted', job_state: 'error', baseline_score: 1 }, 'ddddftt', 4],
    ['awaiting_verify', { status: 'Verifying', job_state: 'idle', baseline_score: 1 }, 'dddddat', 5],
    ['verifying', { status: 'Verifying', job_state: 'running_verify', baseline_score: 1 }, 'dddddat', 5],
    ['dispute', { status: 'Disputed', job_state: 'idle', baseline_score: 1 }, 'dddddda', 6],
    ['settled_release', { status: 'ReleasedFull', job_state: 'idle', baseline_score: 1, settled_by: 'oracle', freelancer_addr: '0xf1' }, 'ddddddd', 7],
    ['settled_refund', { status: 'Refunded', job_state: 'idle', baseline_score: 1, settled_by: 'oracle', freelancer_addr: '0xf1' }, 'ddddddd', 7],
    ['jury_release', { status: 'ReleasedFull', job_state: 'idle', baseline_score: 1, settled_by: 'arbiter', freelancer_addr: '0xf1' }, 'ddddddd', 7],
    ['jury_refund', { status: 'Refunded', job_state: 'idle', baseline_score: 1, settled_by: 'arbiter', freelancer_addr: '0xf1' }, 'ddddddd', 7],
  ];
  const seen = new Set<UiStatus>();
  for (const [ui, patch, want, reached] of cases) {
    const j = { ...base, ...patch };
    check(`input kasus ${ui} benar-benar menghasilkan ${ui}`, deriveUiStatus(j) === ui, deriveUiStatus(j));
    seen.add(deriveUiStatus(j));
    eq(`${ui}: keadaan 7 langkah`, states(j), want);
    eq(`${ui}: "N dari 7 langkah"`, timeline(j, ui, [], T).reached, reached);
  }
  eq('ke-13 status UI teruji', seen.size, Object.keys(UI_STATUS_META).length);

  const reclaimed = { ...base, status: 'Refunded' as const, job_state: 'idle' as const, baseline_score: 1 };
  eq('reclaim (tanpa freelancer): langkah 3–6 dilewati', states(reclaimed), 'ddssssd');
  eq('reclaim: settlement menyebut penarikan', timeline(reclaimed, 'settled_refund', [], T).steps[6].sub, 'Budget ditarik kembali oleh client');
  eq('reclaim: status dana', fundsLabel(reclaimed, 'settled_refund'), ['Ditarik kembali oleh client', 'faint']);

  const open = { ...base, job_state: 'idle' as const, baseline_score: 1 };
  check('batas ambil lewat -> disebut di langkah 3', timeline({ ...open, accept_deadline: '2026-09-03T00:00:00Z' }, 'open', [], T).steps[2].sub.startsWith('Batas ambil lewat'));
  check('tanpa jam (render server) -> tidak menebak "lewat"', !isAcceptExpired(open, null));
  check('batas ambil belum lewat -> tidak lewat', !isAcceptExpired({ ...open, accept_deadline: '2026-09-30T00:00:00Z' }, T.now));

  const acc = { ...base, status: 'Accepted' as const, job_state: 'idle' as const, baseline_score: 1, freelancer_addr: '0xf1' };
  eq('kiriman ditolak -> langkah 4 menyebutnya', timeline(acc, 'in_progress', [act('deposit', 1), act('bond_lock', 2), act('structural_rejected', 3, undefined, 'Konten terlalu pendek')], T).steps[3].sub,
    'Kiriman sebelumnya ditolak · menunggu kiriman ulang');
  eq('rejectedSubmission hanya saat in_progress', rejectedSubmission('awaiting_verify', [act('structural_rejected', 3)]), null);

  // Syarat kontrak escalateStuckJob: Submitted|Verifying dan now > submittedAt + verifyTimeout.
  const ver = { ...base, status: 'Verifying' as const, job_state: 'idle' as const, baseline_score: 1, deliverable_submitted_at: '2026-08-01T00:00:00Z', job_state_at: '2026-08-01T00:00:00Z' };
  check('macet: submittedAt > timeout lalu', isVerifyStuck(ver, T));
  check('belum macet: masih di dalam timeout', !isVerifyStuck({ ...ver, deliverable_submitted_at: '2026-09-04T00:00:00Z' }, T));
  check('tepat di batas -> belum (kontrak memakai >, bukan >=)', !isVerifyStuck({ ...ver, deliverable_submitted_at: new Date(T.now! - 7 * 86400_000).toISOString() }, T));
  check('timeout belum diketahui -> tidak macet', !isVerifyStuck(ver, { ...T, verifyTimeoutSec: null }));
  check('tanpa waktu submit -> tidak macet (jangan menebak)', !isVerifyStuck({ ...ver, deliverable_submitted_at: null }, T));
  check('S-26: macet di SUBMITTED juga bisa dieskalasi', isVerifyStuck({ ...ver, status: 'Submitted' }, T));
  check('status lain (Accepted/Disputed) -> tidak', !isVerifyStuck({ ...ver, status: 'Accepted' }, T) && !isVerifyStuck({ ...ver, status: 'Disputed' }, T));
  check('Oracle sedang verifikasi (lock baru) -> tidak diganggu', !isVerifyStuck({ ...ver, job_state: 'running_verify', job_state_at: new Date(T.now! - 30_000).toISOString() }, T));
  check('lock verifikasi macet -> boleh eskalasi', isVerifyStuck({ ...ver, job_state: 'running_verify', job_state_at: '2026-08-01T00:00:00Z' }, T));
  check('timeline: macet di Submitted disebut di langkah cek struktural',
    timeline({ ...ver, status: 'Submitted' }, 'submitted_pending', [], T).steps[4].sub.startsWith('Macet'));

  const done = timeline({ ...base, status: 'ReleasedFull', job_state: 'idle', baseline_score: 1, baseline_at: '2026-09-01T01:00:00Z', freelancer_addr: '0xf1', settled_by: 'oracle' }, 'settled_release',
    [act('deposit', 1), act('bond_lock', 2), act('final_release', 9), act('structural_release', 5)], T).steps;
  eq('langkah on-chain membawa tx event-nya', [done[0].tx, done[2].tx, done[4].tx, done[6].tx].map((h) => h && Number(BigInt(h))), [1, 2, 5, 9]);
  eq('langkah Oracle tanpa tx', done[1].tx, null);
  eq('langkah belum selesai tanpa waktu', timeline(open, 'open', [act('deposit', 1)], T).steps[2].at, null);
  eq('lastActivity memilih blok terbaru, bukan urutan array',
    lastActivity([act('structural_rejected', 9), act('structural_rejected', 3)], ['structural_rejected'])?.block_number, 9);
}

section('job-view - ledger per kontrak');
{
  const row = (type: string, amount_wei: string | null) => ({ id: type, job_id: 1, tx_hash: '0x', log_index: 0, block_number: 1, type, amount_wei, from_addr: null, to_addr: null, note: null, created_at: '2026-09-01T00:00:00Z' });
  const held = (rows: ActivityEntry[]) => heldInContract(rows)?.toString() ?? null; // eq() memakai JSON: BigInt tidak bisa
  eq('tanpa event on-chain -> null (bukan 0)', held([]), null);
  eq('deposit + bond - structural', held([row('deposit', '1000'), row('bond_lock', '50'), row('structural_release', '200')]), '850');
  eq('selesai -> 0', held([row('deposit', '1000'), row('bond_lock', '50'), row('structural_release', '200'), row('final_release', '850'), row('bond_return', '50')]), '0');
  eq('baris uang tanpa jumlah -> null, bukan angka tebakan', held([row('deposit', null)]), null);
}

section('job-view - audit verdict dihitung ulang di browser');
{
  const seed = `0x${'ab'.repeat(32)}` as const;
  const n = 5, k = subsetSize(n);
  const subset = deriveSubset(seed, n, k);
  const hitOf = (qi: number) => qi % 2 === 0;
  const hits: number[] = subset.map((qi) => (hitOf(qi) ? 1 : 0));
  const score = hits.reduce((a, b) => a + b, 0);
  const verdict: Verdict = { v: 'GEOv1', jobId: 3, brand: 'Kopi Rasa', seed, subset, hits, score, of: k, target: 3, n, multiEngine: false, decision: decide({ score, of: k, target: 3, n }) };
  const vh = verdictHash(verdict);
  const runs = subset.map((qi, i) => ({ id: `r${i}`, job_id: 3, phase: 'verification' as const, query_index: qi, query: 'q', engine: 'mock-a', model: null, hit: hitOf(qi), answer: '', latency_ms: null, created_at: '2026-09-01T00:00:00Z' }));
  const queries = ['q1', 'q2', 'q3', 'q4', 'q5'];
  const content = 'Konten Kopi Rasa yang sudah dioptimasi untuk jawaban AI.';
  const job = { job_id: 3, brand: 'Kopi Rasa', target_count: 3, queries, multi_engine: false, deliverable_content: content, verdict_hash: vh, verification_subset: subset } as Job;
  const pool = queryPoolHash({ brand: 'Kopi Rasa', queries, targetCount: 3, multiEngine: false });
  const on = { onChain: vh, chainEnabled: true, seed, queryPoolHash: pool, deliverableHash: contentHash(content) };
  const res = (j: Job, v: Verdict, r: typeof runs, c: Parameters<typeof auditVerdict>[3]) => {
    const a = auditVerdict(j, v, r, c);
    return a.overall + ':' + a.checks.map((x) => x.result).join('');
  };

  // urutan: subset, hit, keputusan, hash DB, hash chain, seed, parameter, komitmen
  eq('verdict jujur, chain aktif -> semua lolos', res(job, verdict, runs, on), 'y:yyyyyyyy');
  eq('chain nonaktif -> dilewati, bukan gagal', res(job, verdict, runs, { onChain: null, chainEnabled: false }), 's:yyyyssys');
  eq('kontrak menyimpan hash nol -> gagal', res(job, verdict, runs, { ...on, onChain: `0x${'0'.repeat(64)}` }), 'n:yyyynyyy');
  eq('masih memuat kontrak -> dilewati', res(job, verdict, runs, 'loading'), 's:yyyyssys');
  eq('kontrak tak terbaca -> dilewati', res(job, verdict, runs, 'error'), 's:yyyyssys');
  eq('hash on-chain beda -> gagal', res(job, verdict, runs, { ...on, onChain: `0x${'1'.repeat(64)}` }), 'n:yyyynyyy');

  // Pemalsuan: tiap satu diubah, pemeriksaan yang tepat harus menangkapnya.
  const swapped = [...subset].reverse();
  eq('subset diganti (undian diulang) -> subset gagal', res({ ...job, verification_subset: swapped }, { ...verdict, subset: swapped }, runs, on)[2], 'n');
  eq('hit dipelintir (log bilang miss) -> hit gagal', res(job, verdict, runs.map((r, i) => (i === 0 ? { ...r, hit: !r.hit } : r)), on)[3], 'n');
  eq('skor digelembungkan -> hit (jumlah) gagal', res(job, { ...verdict, score: score + 1 }, runs, on)[3], 'n');
  eq('keputusan dibalik -> keputusan gagal', res(job, { ...verdict, decision: verdict.decision === 'release' ? 'refund' : 'release' }, runs, on)[4], 'n');
  eq('verdict diubah setelah di-hash -> hash database gagal', res(job, { ...verdict, brand: 'Kopi Lain' }, runs, on)[5], 'n');
  eq('log tidak lengkap -> hit dilewati, bukan gagal', res(job, verdict, runs.slice(1), on), 's:ysyyyyyy');
  // S-12: verdict yang konsisten dengan DIRINYA SENDIRI tapi tidak terikat ke kontrak ini.
  const seed2 = `0x${'cd'.repeat(32)}` as const;
  const sub2 = deriveSubset(seed2, n, k);
  const forged: Verdict = { ...verdict, seed: seed2, subset: sub2, hits: sub2.map((qi) => (hitOf(qi) ? 1 : 0)) };
  forged.score = forged.hits.reduce((a, b) => a + b, 0);
  forged.decision = decide({ score: forged.score, of: k, target: 3, n });
  const forgedRuns = sub2.map((qi, i) => ({ ...runs[0], id: `f${i}`, query_index: qi, hit: hitOf(qi) }));
  const fj = { ...job, verdict_hash: verdictHash(forged), verification_subset: sub2 };
  const fr = res(fj, forged, forgedRuns, { ...on, onChain: verdictHash(forged) });
  eq('S-12: seed karangan -> 5 cek lama LOLOS, tapi cek seed GAGAL', [fr.slice(2, 7), fr[7]], ['yyyyy', 'n']);
  eq('S-12: target di verdict ≠ kontrak -> parameter gagal', res({ ...job, target_count: 2 }, verdict, runs, on)[8], 'n');
  eq('S-12: jumlah pertanyaan ≠ kontrak -> parameter gagal', res({ ...job, queries: queries.slice(0, 4) }, verdict, runs, on)[8], 'n');
  eq('S-12: pertanyaan ≠ komitmen on-chain -> komitmen gagal', res(job, verdict, runs, { ...on, queryPoolHash: `0x${'11'.repeat(32)}` })[9], 'n');
  eq('S-12: konten yang diukur ≠ hash ditandatangani -> komitmen gagal', res({ ...job, deliverable_content: 'konten lain' }, verdict, runs, on)[9], 'n');
  eq('S-12: seed on-chain nol -> seed gagal', res(job, verdict, runs, { ...on, seed: `0x${'0'.repeat(64)}` })[7], 'n');

  // ---------------- GEOv2 (S-04): seed efektif + blok konfirmasi ----------------
  const K = '0x41462F3092Ca66b7B3d9c8b20337793e2756cC46';
  const B1 = `0x${'b1'.repeat(32)}`, B2 = `0x${'b2'.repeat(32)}`, TX = `0x${'7a'.repeat(32)}`;
  const dh = contentHash(content);
  const mk2 = (blockHash: string): VerdictV2 => {
    const d: VerdictV2 = { v: 'GEOv2', jobId: 3, brand: 'Kopi Rasa', seed, n, of: k, target: 3, multiEngine: false, confirmTx: TX, confirmBlockHash: blockHash, deliverableHash: dh, subset: [], hits: [], score: 0, decision: 'dispute' };
    d.subset = recomputeSubset(d);
    d.hits = d.subset.map((qi) => (hitOf(qi) ? 1 : 0));
    d.score = d.hits.reduce((a, b) => a + b, 0);
    d.decision = decide({ score: d.score, of: k, target: 3, n });
    return d;
  };
  const v2 = mk2(B1);
  const runs2 = v2.subset.map((qi, i) => ({ ...runs[0], id: `v${i}`, query_index: qi, hit: hitOf(qi) }));
  const job2 = { ...job, verdict_hash: verdictHash(v2), verification_subset: v2.subset };
  const input = encodeFunctionData({ abi: geoEscrowAbi, functionName: 'confirmStructural', args: [3n] });
  const txOk = { to: K, input, blockHash: B1, status: 'success' as const };
  const on2 = { ...on, onChain: verdictHash(v2), contract: K, confirmTx: txOk };
  eq('GEOv2 jujur -> semua lolos', res(job2, v2, runs2, on2), 'y:yyyyyyyy');
  check('GEOv2: kanonik v1 TIDAK berubah (hash job 0 & 1 tersimpan permanen di kontrak)', !canonicalVerdict(verdict).includes('GEOv2') && canonicalVerdict(verdict).split('\n').length === 12);
  check('GEOv2: kanonik = 12 baris v1 + confirmTx, blockHash, deliverableHash', canonicalVerdict(v2).split('\n').length === 15 && canonicalVerdict(v2).startsWith('GEOv2\n'));
  eq('GEOv2: heksa huruf besar/kecil -> hash sama', verdictHash({ ...v2, confirmBlockHash: B1.toUpperCase().replace('0X', '0x') }), verdictHash(v2));
  // Oracle memilih blok LAIN (subset lain) — konsisten dengan dirinya sendiri, tapi blok bukan blok konfirmasi.
  const v2b = mk2(B2);
  const runs2b = v2b.subset.map((qi, i) => ({ ...runs[0], id: `w${i}`, query_index: qi, hit: hitOf(qi) }));
  const r2b = res({ ...job, verdict_hash: verdictHash(v2b), verification_subset: v2b.subset }, v2b, runs2b, { ...on2, onChain: verdictHash(v2b) });
  eq('GEOv2: blok undian dipilih sendiri -> cek lama lolos, cek seed & blok GAGAL', [r2b.slice(2, 7), r2b[7]], ['yyyyy', 'n']);
  eq('GEOv2: tx konfirmasi REVERT -> gagal (Oracle bisa memilih blok lewat tx gagal)', res(job2, v2, runs2, { ...on2, confirmTx: { ...txOk, status: 'reverted' } })[7], 'n');
  eq('GEOv2: tx ke kontrak lain -> gagal', res(job2, v2, runs2, { ...on2, confirmTx: { ...txOk, to: '0x0000000000000000000000000000000000000009' } })[7], 'n');
  const inputLain = encodeFunctionData({ abi: geoEscrowAbi, functionName: 'confirmStructural', args: [4n] });
  eq('GEOv2: tx confirmStructural job LAIN -> gagal', res(job2, v2, runs2, { ...on2, confirmTx: { ...txOk, input: inputLain } })[7], 'n');
  eq('GEOv2: tx tidak terbaca (dipangkas RPC) -> dilewati, bukan lolos', res(job2, v2, runs2, { ...on2, confirmTx: null })[7], 's');
  eq('GEOv2: receipt tidak terbaca -> dilewati', res(job2, v2, runs2, { ...on2, confirmTx: { ...txOk, status: null } })[7], 's');
  eq('GEOv2: hash konten di verdict ≠ on-chain -> komitmen gagal', res(job2, { ...v2, deliverableHash: `0x${'dd'.repeat(32)}` }, runs2, on2)[9], 'n');
  check('confirmTxValid: tx sah', confirmTxValid(txOk, 3, K) && !confirmTxValid(txOk, 3, null));

  // Seed efektif: seed kontrak KONSTAN (2) tapi subset tetap berbeda per blok.
  const two = `0x${'0'.repeat(63)}2`;
  const subsetsN6 = new Set([...Array(24)].map((_, i) => {
    const bh = keccak256(toHex(`blok-${i}`));
    return deriveSubset(effectiveSeedV2({ seed: two, confirmBlockHash: bh, jobId: 7, deliverableHash: dh }), 6, subsetSize(6)).join(',');
  }));
  check(`S-04: seed kontrak konstan, 24 blok berbeda -> subset bervariasi (${subsetsN6.size} macam untuk n=6)`, subsetsN6.size >= 3);
  const e = (o: Partial<Parameters<typeof effectiveSeedV2>[0]>) => effectiveSeedV2({ seed: two, confirmBlockHash: B1, jobId: 7, deliverableHash: dh, ...o });
  check('seed efektif berubah bila jobId / blok / konten berubah', new Set([e({}), e({ jobId: 8 }), e({ confirmBlockHash: B2 }), e({ deliverableHash: `0x${'ee'.repeat(32)}` })]).size === 4);
  eq('seed efektif deterministik', e({}), e({}));
  throws('seed efektif menolak blockHash bukan bytes32', () => e({ confirmBlockHash: '0x1234' }));
  throws('seed efektif menolak jobId negatif', () => e({ jobId: -1 }));

  const dm = decisionMath({ score: 2, of: 3, target: 3, n: 5 });
  eq('decisionMath = sisi-sisi decide()', [dm.lhs, dm.rhs, dm.floor], [10, 9, -1]);
}

section('tx - klasifikasi error transaksi (error viem SUNGGUHAN)');
{
  const revert = (msg: string) => new ContractFunctionExecutionError(
    new ContractFunctionRevertedError({ abi: geoEscrowAbi, functionName: 'acceptJob', message: msg }) as unknown as BaseError,
    { abi: geoEscrowAbi, functionName: 'acceptJob', args: [1n], contractAddress: '0x0000000000000000000000000000000000000001' }
  );
  const rejected = new UserRejectedRequestError(new Error('User denied transaction signature'));

  eq('user menolak -> rejected (bukan error)', classifyTxError(rejected, 'write').phase, 'rejected');
  eq('menolak terbungkus berlapis -> tetap rejected', classifyTxError({ name: 'TransactionExecutionError', cause: { name: 'X', cause: rejected } }, 'write').phase, 'rejected');
  eq('kode EIP-1193 4001 polos -> rejected', classifyTxError({ code: 4001, message: 'x' }, 'write').phase, 'rejected');
  eq('menolak saat simulasi (switch dsb.) -> rejected', classifyTxError(rejected, 'simulate').phase, 'rejected');

  const b = classifyTxError(revert('execution reverted: GEO: job not open'), 'simulate');
  eq('revert saat simulasi -> blocked', b.phase, 'blocked');
  check('blocked menyebut alasan kontrak TANPA awalan "execution reverted"', !!b.message?.includes('“GEO: job not open”') && !b.message.includes('execution reverted'), b.message);
  check('blocked menegaskan tidak ada gas terpakai', !!b.message?.includes('tidak ada gas terpakai'));
  eq('revert yang sama saat write -> failed (bukan blocked)', classifyTxError(revert('execution reverted: x'), 'write').phase, 'failed');

  eq('saldo kurang -> failed + pesan saldo', classifyTxError(new InsufficientFundsError({ cause: new BaseError('x') }), 'simulate'), { phase: 'failed', message: TX_MSG.funds });
  eq('akun berganti di tengah jalan -> pesan akun', classifyTxError({ name: 'ConnectorAccountNotFoundError' }, 'write').message, TX_MSG.account);
  eq('chain berubah -> pesan jaringan', classifyTxError({ name: 'ConnectorChainMismatchError' }, 'write').message, TX_MSG.chain);

  const u = classifyTxError(new WaitForTransactionReceiptTimeoutError({ hash: '0xabc' }), 'receipt', 120);
  eq('receipt timeout -> unknown (JANGAN kirim ulang)', u.phase, 'unknown');
  check('unknown menyebut batas waktu & peringatan kirim ganda', !!u.message?.includes('120 detik') && !!u.message.includes('dua kali'), u.message);
  eq('error APA PUN saat receipt -> unknown, bukan failed', classifyTxError(new Error('socket hang up'), 'receipt').phase, 'unknown');

  // Pesan tidak boleh membawa e.message mentah (A21): viem menaruh URL RPC di sana.
  const leaky = { name: 'HttpRequestError', shortMessage: 'HTTP request failed.', message: 'HTTP request failed.\nURL: https://rpc.example/KUNCI-RAHASIA\nRequest body: {...}' };
  const f = classifyTxError(leaky, 'write');
  check('failed memakai shortMessage, bukan message mentah ber-URL', f.message === 'Transaksi gagal: HTTP request failed.' && !f.message.includes('KUNCI'), f.message);
  eq('tanpa shortMessage -> pesan umum', classifyTxError(new Error('rahasia https://x/KUNCI'), 'write').message, 'Transaksi gagal: Kesalahan tak terduga');

  check('isUserRejection: error biasa -> false', !isUserRejection(new Error('x')));
}

section('tx - siklus, sync, peran, konektor');
{
  eq('stepIndex berurutan', (['check', 'sign', 'confirm', 'after', 'sync', 'done', 'rejected'] as const).map(stepIndex), [0, 0, 2, 3, 3, 4, -1]);
  check('fase sibuk = persis check/sign/confirm/after/sync',
    (['idle', 'check', 'sign', 'confirm', 'after', 'sync', 'done', 'rejected', 'blocked', 'reverted', 'failed', 'unknown', 'sync_failed'] as const).filter(isBusy).join() === 'check,sign,confirm,after,sync');

  eq('sync RATE_LIMITED percobaan pertama -> ulangi', syncDecision('RATE_LIMITED', 0), 'retry');
  eq('sync RATE_LIMITED percobaan kedua -> berhenti', syncDecision('RATE_LIMITED', 1), 'give_up');
  eq('sync NOT_FOUND -> berhenti', syncDecision('NOT_FOUND', 0), 'give_up');
  eq('sync jaringan putus -> berhenti', syncDecision('NETWORK', 0), 'give_up');

  const job = { client_addr: '0xabcdef0000000000000000000000000000000001', freelancer_addr: '0xabcdef0000000000000000000000000000000002' };
  eq('client, alamat CHECKSUM dari wallet', relationToJob(job, '0xABCDEF0000000000000000000000000000000001'), 'client');
  eq('freelancer', relationToJob(job, '0xabcdef0000000000000000000000000000000002'), 'freelancer');
  eq('arbiter (bukan pihak di job)', relationToJob(job, '0xAAAA000000000000000000000000000000000009', '0xaaaa000000000000000000000000000000000009'), 'arbiter');
  eq('orang lain -> null', relationToJob(job, '0x9999000000000000000000000000000000000009'), null);
  eq('tanpa wallet -> null', relationToJob(job, undefined), null);
  eq('freelancer kosong tidak cocok dengan apa pun', relationToJob({ ...job, freelancer_addr: null }, ''), null);
  check('sameAddr menolak null/kosong', !sameAddr(null, null) && !sameAddr('', ''));

  const C = (id: string, type = 'injected') => ({ id, type });
  eq('EIP-6963 ada -> cadangan injected disembunyikan (tanpa duplikat MetaMask)', pickConnectors([C('injected'), C('io.metamask'), C('com.coinbase.wallet')], true).map((c) => c.id), ['io.metamask', 'com.coinbase.wallet']);
  eq('tanpa EIP-6963, ada window.ethereum -> cadangan', pickConnectors([C('injected')], true).map((c) => c.id), ['injected']);
  eq('tanpa wallet sama sekali -> kosong (modal: ajakan memasang)', pickConnectors([C('injected')], false), []);
  eq('konektor non-injected tidak ikut', pickConnectors([C('injected'), C('walletConnect', 'walletConnect')], false), []);

  eq('chainName dikenal', chainName(1), 'Ethereum Mainnet');
  eq('chainName tak dikenal -> chain ID', chainName(31337), 'jaringan dengan chain ID 31337');
}

section('create - form MENCERMINKAN validasi backend (POST /api/jobs)');
{
  const now = Date.now();
  const future = toLocalInput(now + 2 * 86_400_000);
  const draft = (p: Partial<Draft> = {}): Draft => ({ brand: '  Kopi Rasa ', brief: '', queries: 'Kopi enak?\r\n\n  Roastery Jogja? \nBiji arabika lokal?', target: '2', budget: '0,003', deadline: future, multiEngine: false, ...p });

  eq('parseQueries: trim, buang baris kosong & \\r', parseQueries(' a \r\n\n b\r\nc '), ['a', 'b', 'c']);
  eq('parseBudgetTbnb koma desimal', parseBudgetTbnb('0,003')?.toString(), '3000000000000000');
  eq('parseBudgetTbnb titik desimal', parseBudgetTbnb('1.5')?.toString(), '1500000000000000000');
  for (const bad of ['', 'abc', '1e3', '-1', '0.0000000000000000001', '1.2.3', '١']) eq(`parseBudgetTbnb "${bad}" -> null`, parseBudgetTbnb(bad), null);

  const ok = checkDraft(draft(), now);
  eq('draf sah -> tanpa error', ok.errors, {});
  eq('brand di-trim', ok.brand, 'Kopi Rasa');

  const errOf = (p: Partial<Draft>, bal?: bigint) => Object.keys(checkDraft(draft(p), now, bal).errors);
  eq('brand kosong', errOf({ brand: '   ' }), ['brand']);
  eq('brand > 100', errOf({ brand: 'x'.repeat(101) }), ['brand']);
  eq('brand dengan baris baru (hash kanonik rusak)', errOf({ brand: 'A\nB' }), ['brand']);
  eq('brief > 1000', errOf({ brief: 'x'.repeat(1001) }), ['brief']);
  eq('2 pertanyaan', errOf({ queries: 'a\nb', target: '1' }), ['queries']);
  eq('7 pertanyaan (target 2 tetap sah)', errOf({ queries: 'a\nb\nc\nd\ne\nf\ng' }), ['queries']);
  eq('pertanyaan kembar beda huruf', errOf({ queries: 'Kopi?\nkopi?\nTeh?' }), ['queries']);
  eq('pertanyaan > 300', errOf({ queries: `a\nb\n${'x'.repeat(301)}` }), ['queries']);
  for (const t of ['0', '4', '1.5', 'abc', '']) eq(`target "${t}" dari 3`, errOf({ target: t }), ['target']);
  eq('budget nol', errOf({ budget: '0' }), ['budget']);
  eq('budget >= saldo', errOf({ budget: '1' }, 1_000_000_000_000_000_000n), ['budget']);
  eq('budget < saldo -> sah', errOf({ budget: '0,5' }, 1_000_000_000_000_000_000n), []);
  eq('batas ambil 5 menit lagi -> DITOLAK (§A7)', errOf({ deadline: toLocalInput(now + 5 * 60_000) }), ['deadline']);
  eq('batas ambil kosong', errOf({ deadline: '' }), ['deadline']);
  eq('batas ambil 61 menit lagi -> sah', errOf({ deadline: toLocalInput(now + 61 * 60_000 + 60_000) }), []);

  // Cermin sungguhan: body yang dikirim FE → validator & perhitungan hash
  // PERSIS seperti app/api/jobs/route.ts.
  const addr = '0xAbC0000000000000000000000000000000000001';
  const snap = makeSnapshot(ok, false, addr, '0x41462F3092Ca66b7B3d9c8b20337793e2756cC46');
  const body = metadataBody(snap, 0);
  const brand = requireText(body.brand, 'Nama brand', LIMITS.brand);
  const pool = requireQueryPool(body.queries, body.targetCount);
  check('backend menerima jobId 0 (§A9)', requireJobId(body.jobId) === 0);
  check('backend menerima alamat client', requireAddress(body.clientAddr, 'clientAddr') === addr.toLowerCase());
  check('backend menerima budgetWei string', requireWei(body.budgetWei, 'budgetWei') === '3000000000000000');
  check('backend menerima acceptDeadline', requireFutureDate(body.acceptDeadline, 'acceptDeadline') === snap.deadlineIso);
  eq('hash yang dihitung SERVER == hash yang dikirim ke kontrak',
    queryPoolHash({ brand, queries: pool.queries, targetCount: pool.targetCount, multiEngine: body.multiEngine === true }), snap.queryPoolHash);
  eq('deadline ISO = detik on-chain × 1000 (tanpa milidetik)', snap.deadlineIso, new Date(Number(snap.deadlineSec) * 1000).toISOString());
  check('detik on-chain dari Date yang SAMA dengan input', Number(snap.deadlineSec) === Math.floor(ok.deadline!.getTime() / 1000));
  eq('multiEngine ikut mengubah hash', makeSnapshot(ok, true, addr, '0x1').queryPoolHash !== snap.queryPoolHash, true);

  // Arah sebaliknya: yang DITOLAK FE juga ditolak backend (tidak ada yang lolos lalu 400 setelah tx).
  const pools: [string, string][] = [['a\nb', '1'], ['a\nb\nc\nd\ne\nf\ng', '2'], ['Kopi?\nkopi?\nTeh?', '1'], ['a\nb\nc', '4'], ['a\nb\nc', '0']];
  for (const [q, t] of pools) {
    const fe = checkDraft(draft({ queries: q, target: t }), now).errors;
    let be = false;
    try { requireQueryPool(parseQueries(q), Number(t)); } catch { be = true; }
    check(`FE & backend sepakat untuk ${JSON.stringify(q.split('\n').length + ' pertanyaan, target ' + t)}`, (!!fe.queries || !!fe.target) === be);
  }
}

section('create - jobId dari event JobCreated di receipt');
{
  const contract = '0x41462F3092Ca66b7B3d9c8b20337793e2756cC46';
  const client = '0xabc0000000000000000000000000000000000001';
  const h = queryPoolHash({ brand: 'Kopi', queries: ['a', 'b', 'c'], targetCount: 2, multiEngine: false });
  const s = { contract, clientAddr: client, queryPoolHash: h, budgetWei: '3000000000000000' };
  const log = (jobId: bigint, o: { address?: string; client?: string; hash?: `0x${string}`; budget?: bigint } = {}) => ({
    address: o.address ?? contract,
    topics: encodeEventTopics({ abi: geoEscrowAbi, eventName: 'JobCreated', args: { jobId, client: (o.client ?? client) as `0x${string}` } }),
    data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bytes32' }, { type: 'uint256' }], [o.budget ?? 3000000000000000n, o.hash ?? h, 1800000000n]),
    blockHash: null, blockNumber: null, logIndex: null, transactionHash: null, transactionIndex: null, removed: false,
  }) as unknown as Log;

  eq('job PERTAMA -> jobId 0, bukan dilewati (§A9)', jobIdFromReceipt([log(0n)], s), 0);
  eq('jobId lain', jobIdFromReceipt([log(7n)], s), 7);
  eq('alamat kontrak checksum vs huruf kecil tetap cocok', jobIdFromReceipt([log(3n, { address: contract.toLowerCase() })], s), 3);
  throws('event dari kontrak LAIN diabaikan -> tidak ada event', () => jobIdFromReceipt([log(1n, { address: '0x0000000000000000000000000000000000000009' })], s));
  throws('client berbeda -> berhenti', () => jobIdFromReceipt([log(1n, { client: '0x0000000000000000000000000000000000000002' })], s));
  throws('queryPoolHash berbeda -> berhenti', () => jobIdFromReceipt([log(1n, { hash: `0x${'11'.repeat(32)}` })], s));
  throws('budget berbeda -> berhenti', () => jobIdFromReceipt([log(1n, { budget: 1n })], s));
  throws('dua event JobCreated -> berhenti', () => jobIdFromReceipt([log(1n), log(2n)], s));
  throws('jobId di atas 2^53 -> berhenti', () => jobIdFromReceipt([log(2n ** 60n)], s));
  const pd = (hash: string, clientAddr: string, at = 1) => ({ hash, snapshot: { clientAddr, contract }, at });
  const v2 = (...ps: unknown[]) => JSON.stringify(ps);
  eq('parsePending: milik wallet & kontrak lain -> kosong', parsePending({ v2: v2(pd('0x1', '0xother')), v1: null }, client, contract), []);
  eq('parsePending: rusak -> kosong, bukan melempar', parsePending({ v2: '{bukan json', v1: '[' }, client, contract), []);
  eq('parsePending: cocok (tanpa membedakan huruf)', parsePending({ v2: v2(pd('0x1', client.toUpperCase().replace('0X', '0x'))), v1: null }, client, contract.toLowerCase()).length, 1);
  // Temuan audit S-14: kontrak kedua dulu MENIMPA catatan pertama.
  eq('parsePending: DUA kontrak tertunda sama-sama tersimpan, terlama dulu',
    parsePending({ v2: v2(pd('0x2', client, 20), pd('0x1', client, 10)), v1: null }, client, contract).map((p) => p.hash), ['0x1', '0x2']);
  eq('parsePending: catatan v1 (satu slot lama) ikut terbaca',
    parsePending({ v2: v2(pd('0x2', client, 20)), v1: JSON.stringify(pd('0x1', client, 10)) }, client, contract).map((p) => p.hash), ['0x1', '0x2']);
  eq('parsePendingAll: hash sama di v1 & v2 tidak dobel', parsePendingAll({ v2: v2(pd('0x1', client)), v1: JSON.stringify(pd('0x1', client)) }).length, 1);
  eq('parsePendingAll: wallet lain TIDAK dibuang (hanya disaring saat tampil)', parsePendingAll({ v2: v2(pd('0x1', client), pd('0x9', '0xother')), v1: null }).length, 2);
}

section('deliverable-lock - konten terkunci ke hash ON-CHAIN, bukan kiriman pertama');
{
  const A = `0x${'aa'.repeat(32)}`, B = `0x${'bb'.repeat(32)}`, Z = `0x${'00'.repeat(32)}`;
  const L = (o: Parameters<typeof lockedDeliverableHash>[0]) => lockedDeliverableHash(o);
  eq('chain aktif, belum ditandatangani (nol) -> bebas', L({ chainEnabled: true, onChainHash: Z, dbHash: A }), null);
  eq('chain aktif, belum terbaca -> bebas', L({ chainEnabled: true, onChainHash: null, dbHash: A }), null);
  eq('chain aktif: hash DB (kiriman pertama) DIABAIKAN', L({ chainEnabled: true, onChainHash: undefined, dbHash: B }), null);
  eq('chain aktif, sudah ditandatangani -> terkunci ke hash on-chain', L({ chainEnabled: true, onChainHash: A.toUpperCase().replace('0X', '0x'), dbHash: B }), A);
  eq('chain mati -> perilaku lama (hash DB)', L({ chainEnabled: false, onChainHash: A, dbHash: B }), B);
  eq('chain mati, DB kosong -> bebas', L({ chainEnabled: false, onChainHash: null, dbHash: null }), null);
  check('revisi sebelum tanda tangan diterima', contentAllowed(null, B));
  check('setelah tanda tangan: konten SAMA diterima (huruf besar/kecil)', contentAllowed(A, A.toUpperCase().replace('0X', '0x')));
  check('setelah tanda tangan: konten LAIN ditolak', !contentAllowed(A, B));
  check('isEmptyHash: nol / null / kosong', isEmptyHash(Z) && isEmptyHash(null) && isEmptyHash('') && !isEmptyHash(A));
}

section('fase 7 - penjaga ambil kontrak & kirim hasil');
{
  const client = '0xAbC0000000000000000000000000000000000001';
  const fl = '0xabc0000000000000000000000000000000000002';
  const other = '0xABC0000000000000000000000000000000000003';
  const roles = { oracle: '0xa87d9c3304b13a0325ae91a05d2322f4c8f3a139', arbiter: '0xdce01c269c513246b7dcc06f1ae84de022048df7' };
  const now = Date.parse('2026-09-26T00:00:00Z');
  const open = { status: 'Open' as const, accept_deadline: '2026-09-28T00:00:00Z', client_addr: client.toLowerCase() };
  const reason = (a: { ok: boolean; reason?: string }) => (a.ok ? 'ok' : a.reason!);
  eq('orang lain, terbuka -> boleh', reason(acceptGuard(open, 'open', other, roles, now)), 'ok');
  eq('belum terhubung -> ok (TxButton menawarkan "Hubungkan")', reason(acceptGuard(open, 'open', undefined, roles, now)), 'ok');
  check('client sendiri (checksum vs huruf kecil) -> DITOLAK', reason(acceptGuard(open, 'open', client, roles, now)).includes('client kontrak ini'));
  check('arbiter -> ditolak', reason(acceptGuard(open, 'open', roles.arbiter.toUpperCase().replace('0X', '0x'), roles, now)).includes('arbiter'));
  check('oracle -> ditolak', reason(acceptGuard(open, 'open', roles.oracle, roles, now)).includes('Oracle'));
  check('baseline belum selesai -> ditolak', reason(acceptGuard(open, 'baseline_running', other, roles, now)).includes('baseline'));
  check('baseline gagal -> ditolak', reason(acceptGuard(open, 'baseline_failed', other, roles, now)).includes('Baseline gagal'));
  check('batas ambil lewat -> ditolak', reason(acceptGuard({ ...open, accept_deadline: '2026-09-25T00:00:00Z' }, 'open', other, roles, now)).includes('lewat'));
  check('sudah diambil -> ditolak', reason(acceptGuard({ ...open, status: 'Accepted' }, 'in_progress', other, roles, now)).includes('tidak terbuka'));

  const acc = { status: 'Accepted' as const, freelancer_addr: fl };
  eq('freelancer (checksum) -> boleh kirim', reason(submitGuard(acc, fl.toUpperCase().replace('0X', '0x'))), 'ok');
  check('orang lain -> tidak boleh kirim', reason(submitGuard(acc, other)).includes('Hanya freelancer'));
  check('sudah Submitted -> tidak boleh kirim ulang', reason(submitGuard({ ...acc, status: 'Submitted' }, fl)).includes('sedang dikerjakan'));

  // Aturan structural yang dipakai form = fungsi server itu sendiri.
  eq('structural: < 40 karakter', checkStructural('Kopi Lereng Merapi enak', 'Kopi Lereng Merapi').reason, 'too_short');
  eq('structural: tanpa brand', checkStructural('x'.repeat(60), 'Kopi Lereng Merapi').reason, 'brand_not_mentioned');
  eq('structural: lolos', checkStructural('Kopi Lereng Merapi adalah roastery arabika dari Sleman, Yogyakarta.', 'Kopi Lereng Merapi').pass, true);
}

section('format - saldo wallet ringkas (dipotong ke BAWAH)');
{
  eq('18 digit -> 4 desimal, dipotong bukan dibulatkan', formatTBNBShort('4610820789818713089'), '4.6108 tBNB');
  eq('0.99999 -> 0.9999, BUKAN 1', formatTBNBShort('999990000000000000'), '0.9999 tBNB');
  eq('angka bulat', formatTBNBShort('2000000000000000000'), '2 tBNB');
  eq('nol di belakang dibuang', formatTBNBShort('1500000000000000000'), '1.5 tBNB');
  eq('nol tepat -> 0', formatTBNBShort(0n), '0 tBNB');
  eq('debu positif -> "< 0.0001", bukan 0', formatTBNBShort('12345'), '< 0.0001 tBNB');
  eq('tepat 0.0001', formatTBNBShort('100000000000000'), '0.0001 tBNB');
  eq('di atas 2^53 tetap tepat', formatTBNBShort('123456789012345678901234'), '123456.789 tBNB');
  eq('desimal lain', formatTBNBShort('4610820789818713089', 2), '4.61 tBNB');
}

section('ledger - rincian per wallet');
{
  const W = '0xAbC0000000000000000000000000000000000001';
  const j = (status: Job['status'], client: string, fl: string | null, budget: string, rel: string, bond: string | null) =>
    ({ status, client_addr: client, freelancer_addr: fl, budget_wei: budget, structural_released_wei: rel, bond_wei: bond });
  const w = W.toLowerCase(), other = '0x0000000000000000000000000000000000000009';
  const jobs = [
    j('Open', w, null, '1000', '0', null),                 // client: 1000
    j('Verifying', w, other, '1000', '200', '50'),         // client: 800
    j('Accepted', other, w, '4000', '0', '200'),           // freelancer: bond 200
    j('ReleasedFull', w, other, '9999', '0', '1'),          // selesai: tidak dihitung
    j('Refunded', other, w, '9999', '0', '7'),              // selesai: tidak dihitung
  ];
  eq('lockedFor: client (budget − struktural) + freelancer (bond), alamat checksum', lockedFor(jobs, W).toString(), '2000');
  eq('lockedFor: wallet lain = client job Accepted (4000) + bond freelancer di Verifying (50)', lockedFor(jobs, other).toString(), '4050');
  const rows = [
    { type: 'final_release', amount_wei: '750', to_addr: w }, // sisa 700 + bond 50
    { type: 'bond_return', amount_wei: '50', to_addr: w },   // rincian, sudah di atas
    { type: 'deposit', amount_wei: '1000', to_addr: w },     // IN, bukan diterima
    { type: 'final_refund', amount_wei: '300', to_addr: other },
    { type: 'structural_release', amount_wei: null, to_addr: w },
  ];
  eq('receivedBy: hanya baris OUT ke wallet itu, bond tidak dua kali', receivedBy(rows, W).toString(), '750');
}

// ---------------------------------------------------------
section('Fase 8 - lock macet, polling, tombol aksi Oracle');
{
  const NOW = Date.parse('2026-09-26T15:00:00Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const J = (o: Partial<Job>) => ({
    status: 'Verifying', job_state: 'idle', job_state_at: ago(0), baseline_score: 1, settled_by: null,
    last_error: null, deliverable_submitted_at: null, ...o,
  }) as Job;
  const ui = (j: Job) => deriveUiStatus(j);
  const offer = (j: Job, now: number | null = NOW) => oracleOffer(j, ui(j), now);

  // isStaleLock / isLive
  check('running_verify 4 mnt = macet', isStaleLock(J({ job_state: 'running_verify', job_state_at: ago(STALE_LOCK_MS + 60_000) }), NOW));
  check('running_verify 1 mnt = belum macet', !isStaleLock(J({ job_state: 'running_verify', job_state_at: ago(60_000) }), NOW));
  check('idle tidak pernah macet', !isStaleLock(J({ job_state: 'idle', job_state_at: ago(9e9) }), NOW));
  check('tanpa jam (render server) -> tidak menebak', !isStaleLock(J({ job_state: 'running_verify', job_state_at: ago(9e9) }), null));
  check('verifying berjalan -> di-polling', isLive(J({ job_state: 'running_verify', job_state_at: ago(10_000) }), NOW));
  check('verifying macet -> TIDAK di-polling (menunggu tombol)', !isLive(J({ job_state: 'running_verify', job_state_at: ago(STALE_LOCK_MS + 1) }), NOW));
  check('awaiting_verify -> tidak di-polling', !isLive(J({}), NOW));
  check('settle -> tidak di-polling', !isLive(J({ status: 'ReleasedFull' }), NOW));
  check('submitted_pending -> di-polling', isLive(J({ status: 'Submitted' }), NOW));
  check('baseline_running -> di-polling', isLive(J({ status: 'Open', baseline_score: null, job_state: 'running_baseline', job_state_at: ago(5_000) }), NOW));

  // pollIntervalFor — Fase 9 (daftar & detail)
  eq('ada yang hidup -> cepat', pollIntervalFor([J({ status: 'ReleasedFull' }), J({ status: 'Submitted' })], NOW), POLL_FAST_MS);
  eq('menunggu pihak lain (Open/Accepted/Verifying/Disputed) -> lambat', [J({ status: 'Open' }), J({ status: 'Accepted' }), J({ status: 'Verifying' }), J({ status: 'Disputed' })].map((j) => pollIntervalFor([j], NOW)), [POLL_SLOW_MS, POLL_SLOW_MS, POLL_SLOW_MS, POLL_SLOW_MS]);
  eq('semua selesai -> berhenti (nol permintaan berulang)', pollIntervalFor([J({ status: 'ReleasedFull' }), J({ status: 'Refunded' })], NOW), false);
  eq('daftar kosong -> berhenti', pollIntervalFor([], NOW), false);
  eq('lock macet -> tidak cepat (menunggu tombol), tapi tetap lambat', pollIntervalFor([J({ job_state: 'running_verify', job_state_at: ago(STALE_LOCK_MS + 1) })], NOW), POLL_SLOW_MS);

  // oracleOffer
  eq('awaiting_verify -> Verifikasi sekarang', offer(J({}))?.label, 'Verifikasi sekarang');
  eq('awaiting_verify + error (settlement gagal) -> coba lagi, jalur yang SAMA', [offer(J({ job_state: 'error' }))?.kind, offer(J({ job_state: 'error' }))?.label], ['verify', 'Coba verifikasi lagi']);
  eq('verifying berjalan -> tanpa tombol', offer(J({ job_state: 'running_verify', job_state_at: ago(30_000) })), null);
  eq('verifying macet -> Lanjutkan verifikasi', offer(J({ job_state: 'running_verify', job_state_at: ago(STALE_LOCK_MS + 1) }))?.label, 'Lanjutkan verifikasi');
  eq('baseline gagal -> ukur ulang', offer(J({ status: 'Open', baseline_score: null, job_state: 'error' }))?.kind, 'baseline');
  eq('baseline berjalan -> tanpa tombol', offer(J({ status: 'Open', baseline_score: null, job_state: 'running_baseline', job_state_at: ago(20_000) })), null);
  eq('baseline macet -> ukur ulang', offer(J({ status: 'Open', baseline_score: null, job_state: 'running_baseline', job_state_at: ago(STALE_LOCK_MS + 1) }))?.kind, 'baseline');
  eq('submitted baru saja -> tunggu, tanpa tombol', offer(J({ status: 'Submitted', deliverable_submitted_at: ago(30_000) })), null);
  eq('submitted idle > 2 mnt -> konfirmasi ulang lewat sync', offer(J({ status: 'Submitted', deliverable_submitted_at: ago(CONFIRM_GRACE_MS + 1) }))?.kind, 'sync');
  eq('konfirmasi berjalan -> tanpa tombol', offer(J({ status: 'Submitted', job_state: 'running_structural', job_state_at: ago(20_000), deliverable_submitted_at: ago(9e6) })), null);
  eq('konfirmasi macet -> konfirmasi ulang', offer(J({ status: 'Submitted', job_state: 'running_structural', job_state_at: ago(STALE_LOCK_MS + 1) }))?.kind, 'sync');
  eq('structural gagal sistem -> coba lagi', offer(J({ status: 'Submitted', job_state: 'error', last_error: 'RPC putus' }))?.kind, 'sync');
  eq('structural gagal hash tidak cocok -> TANPA coba lagi (pasti gagal lagi)', offer(J({ status: 'Submitted', job_state: 'error', last_error: HASH_MISMATCH_ERROR })), null);
  eq('open / in_progress / settle -> tanpa tombol Oracle', [offer(J({ status: 'Open' })), offer(J({ status: 'Accepted' })), offer(J({ status: 'Refunded' }))], [null, null, null]);

  // verifyOutcome
  const vo = (o: Partial<VerifyResult>) => verifyOutcome({ score: 3, of: 4, decision: 'release', settledOnChain: true, alreadySettled: false, resumedSettlement: false, ...o });
  check('release: cair ke freelancer, sisa + bond', vo({}).text.includes('cair ke freelancer') && vo({}).text.includes('bond') && vo({}).tone === 'ok');
  check('refund: kembali ke client', vo({ decision: 'refund', score: 0 }).text.includes('kembali ke client'));
  check('dispute: zona abu -> arbiter, nada peringatan', vo({ decision: 'dispute' }).text.includes('arbiter') && vo({ decision: 'dispute' }).tone === 'warn');
  check('alreadySettled disebut (tidak ada transaksi baru)', vo({ alreadySettled: true }).text.includes('tidak ada transaksi baru'));
  check('mode dev disebut', vo({ settledOnChain: false }).text.includes('Mode pengembangan'));
}

// ---------------------------------------------------------
section('Form buat kontrak - kesalahan menunjuk KOLOMNYA');
{
  eq('tanpa kesalahan -> null', firstInvalid({}), null);
  eq('urutan layar, bukan urutan pemeriksaan: batas ambil & brand -> brand dulu', firstInvalid({ deadline: 'Minimal 1 jam', brand: 'Wajib' }), { field: 'brand', message: 'Wajib', others: 1 });
  eq('satu kesalahan saja -> others 0', firstInvalid({ deadline: 'Minimal 1 jam dari sekarang.' })?.others, 0);
  check('setiap kolom punya label', FIELD_ORDER.every((f) => !!FIELD_LABEL[f]));
  // Kasus nyata 27-09: batas ambil diisi +1 jam, lalu waktu berjalan saat mengisi kolom lain.
  const now = Date.parse('2026-09-27T10:00:00Z');
  const d: Draft = { brand: 'Uji', brief: '', queries: 'a?\nb?\nc?', target: '1', budget: '0,0005', deadline: toLocalInput(now + 60 * 60_000), multiEngine: false };
  const later = checkDraft(d, now + 5 * 60_000, null);
  eq('batas ambil tepat +1 jam, 5 menit kemudian -> kolom "deadline" yang ditunjuk', firstInvalid(later.errors)?.field, 'deadline');
}

// ---------------------------------------------------------
section('Fase 10 - S-22 konten bertanda tangan tidak datang -> dikembalikan');
{
  const now = Date.parse('2026-09-27T10:00:00Z');
  const sec = (msAgo: number) => BigInt(Math.floor((now - msAgo) / 1000));
  check('baru dikirim 10 menit -> masih ditunggu', !signedContentGraceExpired(sec(10 * 60_000), now));
  check('lewat 2 jam -> dikembalikan', signedContentGraceExpired(sec(SIGNED_CONTENT_GRACE_MS + 60_000), now));
  check('submittedAt 0 (belum/di-reset kontrak) -> tidak pernah', !signedContentGraceExpired(0n, now));
  check('menerima number juga (dari kolom DB)', signedContentGraceExpired((now - SIGNED_CONTENT_GRACE_MS - 1000) / 1000, now));
  check('alasan aman dipublikasi (tanpa isi konten) & ≤ 200 karakter (dipotong kontrak)', SIGNED_CONTENT_MISSING_REASON.length <= 200);
}

// ---------------------------------------------------------
section('Fase 10 - S-09 budget minimum & kuota AI, S-19 mock di produksi');
{
  const now = Date.parse('2026-09-27T10:00:00Z');
  const d = (budget: string): Draft => ({ brand: 'Uji', brief: '', queries: 'a?\nb?\nc?', target: '1', budget, deadline: toLocalInput(now + 2 * 3600_000), multiEngine: false });
  eq('budget 0,0001 -> ditolak (di bawah minimum)', checkDraft(d('0,0001'), now, null).errors.budget, 'Budget minimum 0,0005 tBNB.');
  eq('budget tepat 0,0005 -> diterima', checkDraft(d('0,0005'), now, null).errors.budget, undefined);
  eq('MIN_BUDGET_WEI = 0,0005 tBNB', MIN_BUDGET_WEI.toString(), toWei('0.0005'));
  const keep = { ...process.env };
  try {
    delete process.env.ORACLE_DAILY_CALL_LIMIT; delete process.env.ORACLE_CLIENT_DAILY_CALL_LIMIT;
    eq('kuota default: global 400, per client 60', [env.oracleDailyCallLimit, env.oracleClientDailyCallLimit], [400, 60]);
    process.env.ORACLE_DAILY_CALL_LIMIT = '50'; process.env.ORACLE_CLIENT_DAILY_CALL_LIMIT = 'abc';
    eq('kuota dari env; nilai tidak sah -> default', [env.oracleDailyCallLimit, env.oracleClientDailyCallLimit], [50, 60]);
    process.env.ORACLE_DAILY_CALL_LIMIT = '0';
    eq('kuota 0 / negatif -> default (bukan mematikan pengaman)', env.oracleDailyCallLimit, 400);
    delete process.env.ALLOW_MOCK_ORACLE_IN_PRODUCTION;
    check('mock di produksi: default TIDAK diizinkan', !env.allowMockInProduction);
  } finally {
    for (const k of ['ORACLE_DAILY_CALL_LIMIT', 'ORACLE_CLIENT_DAILY_CALL_LIMIT', 'ALLOW_MOCK_ORACLE_IN_PRODUCTION']) {
      if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k];
    }
  }
}

// ---------------------------------------------------------
section('Fase 8 - K2: target tidak di atas baseline');
{
  check('job 0 nyata: target 1 = baseline 1 -> peringatan', targetNotAboveBaseline({ baseline_score: 1, target_count: 1 }));
  check('target di bawah baseline -> peringatan', targetNotAboveBaseline({ baseline_score: 3, target_count: 2 }));
  check('job 1 nyata: target 3 > baseline 1 -> tanpa peringatan', !targetNotAboveBaseline({ baseline_score: 1, target_count: 3 }));
  check('baseline belum terukur -> tidak menebak', !targetNotAboveBaseline({ baseline_score: null, target_count: 1 }));
  check('baseline 0, target 1 -> tanpa peringatan', !targetNotAboveBaseline({ baseline_score: 0, target_count: 1 }));
}

// ---------------------------------------------------------
section('Fase 8 - admin arbiter & pagar fungsi owner');
{
  const OWNER = '0x8766d055bB79B511FCC34Bd1573ce612dFa4057D';
  const ORACLE = '0xA87D9c3304B13a0325Ae91A05d2322f4C8f3a139';
  const OLD = '0xd1ff61def4D7c6dB938A4501f460b5176fcbCd78';
  const NEW = '0xdCe01c269c513246b7dCC06F1Ae84de022048Df7';
  const ctx = { current: OLD, owner: OWNER, oracle: ORACLE, me: OWNER };
  const ca = (s: string) => checkNewArbiter(s, ctx);
  eq('alamat sah -> ok, dinormalisasi ke checksum', ca(NEW.toLowerCase()), { ok: true, address: NEW });
  eq('spasi di tepi diabaikan', ca(`  ${NEW}  `).ok, true);
  eq('kosong -> ditolak', ca('').ok, false);
  eq('bukan alamat (private key 64 hex) -> ditolak', ca(`0x${'ab'.repeat(32)}`).ok, false);
  // checksum salah: ganti huruf besar/kecil satu karakter
  const typo = NEW.replace('dCe0', 'dce0');
  eq('checksum salah (huruf campuran) -> ditolak', ca(typo).ok, false);
  eq('alamat nol -> ditolak', ca(`0x${'0'.repeat(40)}`).ok, false);
  eq('sama dengan arbiter sekarang -> ditolak', ca(OLD).ok, false);
  eq('owner/client sebagai arbiter -> ditolak (panel juri tak pernah muncul)', ca(OWNER.toLowerCase()).ok, false);
  eq('Oracle sebagai arbiter -> ditolak', ca(ORACLE).ok, false);

  // PAGAR: fungsi owner yang berbahaya tidak boleh bisa dikirim dari FE.
  const txSrc = readFileSync(new URL('../lib/tx.ts', import.meta.url), 'utf8');
  const u = txSrc.match(/export type UserWriteFn =([\s\S]*?);/);
  const fns = u ? [...u[1].matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]) : [];
  check('UserWriteFn terbaca', fns.length >= 7);
  for (const bahaya of ['renounceOwnership', 'transferOwnership', 'setOracle', 'setVerifyTimeout', 'confirmStructural', 'settleRelease', 'settleRefund', 'raiseDispute', 'rejectStructural']) {
    check(`UserWriteFn TIDAK memuat ${bahaya}`, !fns.includes(bahaya));
  }
  const setArb = geoEscrowAbi.find((x) => x.type === 'function' && x.name === 'setArbiter') as { inputs: { type: string }[]; stateMutability: string } | undefined;
  check('ABI setArbiter(address) nonpayable', !!setArb && setArb.inputs.length === 1 && setArb.inputs[0].type === 'address' && setArb.stateMutability === 'nonpayable');
}

// ---------------------------------------------------------
section('indexer - settled_by, catatan eskalasi, bond sebagai rincian (Tahap 0 audit)');
{
  // keBarisActivity() membaca alamat kontrak dari env; nilai apa pun cukup di sini.
  process.env.GEO_ESCROW_ADDRESS ??= '0x41462F3092Ca66b7B3d9c8b20337793e2756cC46';
  const lg = (eventName: string, args: Record<string, unknown>) =>
    ({ eventName, args, blockNumber: 1n, logIndex: 0, transactionHash: `0x${'ab'.repeat(32)}` }) as unknown as LogTerurai;
  eq('settledByDari: tanpa Settled -> null', settledByDari([lg('JobCreated', {}), lg('BondSettled', {})]), null);
  eq('settledByDari: Settled oleh Oracle', settledByDari([lg('Settled', { byArbiter: false })]), 'oracle');
  eq('settledByDari: Settled oleh arbiter (S-11: dulu tampil sebagai Oracle)', settledByDari([lg('ArbiterDecided', {}), lg('Settled', { byArbiter: true })]), 'arbiter');
  const esc = keBarisActivity(lg('DisputeRaised', { verdictHash: `0x${'00'.repeat(32)}` }), null);
  check('DisputeRaised hash nol = eskalasi waktu, bukan "zona abu"', !!esc?.note?.includes('batas waktu') && !esc.note.includes('zona abu'), esc?.note ?? '');
  const zona = keBarisActivity(lg('DisputeRaised', { verdictHash: `0x${'12'.repeat(32)}` }), null);
  check('DisputeRaised dari Oracle tetap "zona abu"', !!zona?.note?.includes('zona abu'), zona?.note ?? '');
  const slash = keBarisActivity(lg('BondSettled', { recipient: '0x0000000000000000000000000000000000000002', amount: 50n, slashed: true }), null);
  check('BondSettled -> bond_slash, dan NETRAL di ledger (S-16)', slash?.type === 'bond_slash' && (LEDGER_NEUTRAL as readonly string[]).includes('bond_slash'));
  check('bond_return juga netral, tidak lagi OUT', (LEDGER_NEUTRAL as readonly string[]).includes('bond_return') && !(LEDGER_OUT as readonly string[]).includes('bond_return'));
  // Log tertinggal dari status (27-09, job 3: Settled tidak tercatat karena node RPC tertinggal).
  eq('aktivitasWajib: ReleasedFull menuntut baris pencairan', aktivitasWajib(5), ['final_release', 'jury_release']);
  eq('aktivitasWajib: Refunded menuntut refund ATAU reclaim', aktivitasWajib(6), ['final_refund', 'jury_refund', 'reclaim']);
  eq('aktivitasWajib: Submitted tidak punya baris khas', aktivitasWajib(2), null);
  check('aktivitasWajib: semua tipe yang dituntut adalah tipe ledger yang dikenal',
    [0, 1, 2, 3, 4, 5, 6].every((st) => (aktivitasWajib(st) ?? []).every((t) => [...LEDGER_IN, ...LEDGER_OUT, ...LEDGER_NEUTRAL].includes(t as never))));
  check('isHashMismatch: cocok dengan pesan server', isHashMismatch({ last_error: HASH_MISMATCH_ERROR }));
  check('isHashMismatch: gangguan biasa -> false', !isHashMismatch({ last_error: 'Worker timeout -- silakan coba lagi' }) && !isHashMismatch({ last_error: null }));
}

// ---------------------------------------------------------
// lib/api.ts memakai fetch — diuji dengan fetch palsu, tanpa jaringan.
async function checkApiClient() {
  section('api - klien amplop respons');
  const realFetch = globalThis.fetch;
  const stub = (status: number, body: unknown, raw = false) => {
    globalThis.fetch = (async () => new Response(raw ? String(body) : JSON.stringify(body), { status })) as typeof fetch;
  };
  const rejects = async (name: string, fn: () => Promise<unknown>, code: string, status: number) => {
    try { await fn(); check(name, false, 'tidak melempar'); }
    catch (e) {
      const ok = e instanceof ApiClientError && e.code === code && e.status === status;
      check(name, ok, e instanceof ApiClientError ? `code=${e.code} status=${e.status}` : String(e));
    }
  };
  try {
    stub(200, { ok: true, jobs: [1, 2], total: 2 });
    eq('sukses: field ok dibuang, data utuh', await api<{ jobs: number[]; total: number }>('/api/jobs'), { jobs: [1, 2], total: 2 });

    stub(400, { ok: false, code: 'HASH_MISMATCH', error: 'Data tidak cocok' });
    await rejects('gagal: code & status dari server diteruskan', () => api('/api/jobs'), 'HASH_MISMATCH', 400);

    stub(502, '<html>Bad Gateway</html>', true);
    await rejects('bukan JSON -> BAD_RESPONSE', () => api('/api/jobs'), 'BAD_RESPONSE', 502);

    stub(200, { jobs: [] });
    await rejects('JSON tanpa field ok -> BAD_RESPONSE', () => api('/api/jobs'), 'BAD_RESPONSE', 200);

    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await rejects('jaringan putus -> NETWORK, status 0', () => api('/api/jobs'), 'NETWORK', 0);

    let seen: RequestInit | undefined;
    globalThis.fetch = (async (_u: unknown, init?: RequestInit) => { seen = init; return new Response(JSON.stringify({ ok: true, deliverableHash: '0xab' })); }) as typeof fetch;
    await apiPost('/api/jobs/0/deliverable', { content: 'x' });
    check('apiPost: method POST', seen?.method === 'POST');
    check('apiPost: body JSON', seen?.body === JSON.stringify({ content: 'x' }));
    check('apiPost: Content-Type JSON', (seen?.headers as Record<string, string> | undefined)?.['Content-Type'] === 'application/json');
  } finally {
    globalThis.fetch = realFetch;
  }
}

// POST /api/jobs idempoten — fetch palsu, tanpa jaringan.
async function checkSaveMetadata() {
  section('create - simpan metadata idempoten');
  const realFetch = globalThis.fetch;
  const h = queryPoolHash({ brand: 'Kopi', queries: ['a', 'b', 'c'], targetCount: 2, multiEngine: false });
  const s = { clientAddr: '0xabc0000000000000000000000000000000000001', contract: '0x1', brand: 'Kopi', brief: null, queries: ['a', 'b', 'c'], targetCount: 2, multiEngine: false, budgetWei: '1', deadlineSec: '1800000000', deadlineIso: new Date(1800000000 * 1000).toISOString(), queryPoolHash: h };
  const calls: string[] = [];
  const stub = (post: [number, unknown], get: [number, unknown]) => {
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const [st, body] = init?.method === 'POST' ? post : get;
      return new Response(JSON.stringify(body), { status: st });
    }) as typeof fetch;
  };
  const resolves = async (name: string, fn: () => Promise<unknown>) => { try { await fn(); check(name, true); } catch (e) { check(name, false, String(e)); } };
  const rejects = async (name: string, fn: () => Promise<unknown>) => { try { await fn(); check(name, false, 'tidak melempar'); } catch { check(name, true); } };
  try {
    stub([200, { ok: true, jobId: 0 }], [404, {}]);
    await resolves('POST sukses -> selesai', () => saveJobMetadata(s, 0));

    stub([400, { ok: false, code: 'VALIDATION', error: 'Job 0 sudah terdaftar' }], [200, { ok: true, job: { query_pool_hash: h.toUpperCase().replace('0X', '0x') } }]);
    await resolves('POST ulang "sudah terdaftar" + job di DB hash SAMA -> dianggap sukses', () => saveJobMetadata(s, 0));

    stub([400, { ok: false, code: 'VALIDATION', error: 'Job 0 sudah terdaftar' }], [200, { ok: true, job: { query_pool_hash: `0x${'22'.repeat(32)}` } }]);
    await rejects('job di DB hash BERBEDA -> gagal (bukan menimpa)', () => saveJobMetadata(s, 0));

    stub([400, { ok: false, code: 'HASH_MISMATCH', error: 'Data tidak cocok' }], [404, { ok: false, code: 'NOT_FOUND', error: 'x' }]);
    calls.length = 0;
    await rejects('HASH_MISMATCH -> gagal, tidak diulang', () => saveJobMetadata(s, 0));
    eq('HASH_MISMATCH: satu POST + satu GET pemeriksa', calls, ['POST /api/jobs', 'GET /api/jobs/0']);
  } finally {
    globalThis.fetch = realFetch;
  }
}

// POST /deliverable: revisi sebelum tanda tangan (sync lalu ulang) — fetch palsu.
async function checkDeliverablePost() {
  section('fase 7 - kirim konten (revisi, rate limit, terkunci on-chain)');
  const realFetch = globalThis.fetch;
  const realTimeout = globalThis.setTimeout;
  // Lewati jeda 2,1 dtk supaya uji tetap cepat.
  globalThis.setTimeout = ((fn: () => void) => { fn(); return 0; }) as unknown as typeof setTimeout;
  const H = `0x${'ab'.repeat(32)}`;
  const run = async (script: [number, unknown][]) => {
    const calls: string[] = [];
    let i = 0;
    globalThis.fetch = (async (url: string) => {
      calls.push(String(url).replace(/^.*\/api/, ''));
      const [st, body] = script[Math.min(i++, script.length - 1)];
      return new Response(JSON.stringify(body), { status: st });
    }) as typeof fetch;
    let res: unknown, err: unknown;
    try { res = await postDeliverable(0, 'isi'); } catch (e) { err = e; }
    return { calls, res, err };
  };
  const okBody = { ok: true, deliverableHash: H, structuralPass: true, length: 3 };
  const mismatch = { ok: false, code: 'HASH_MISMATCH', error: 'x' };
  try {
    let r = await run([[200, okBody]]);
    eq('sukses langsung: satu POST', r.calls, ['/jobs/0/deliverable']);
    eq('hash dari respons server', (r.res as { hash: string }).hash, H);

    r = await run([[400, mismatch]]);
    check('HASH_MISMATCH (terkunci on-chain) -> pesan jelas', r.err instanceof Error && (r.err as Error).message.includes('terkunci on-chain'), String(r.err));
    eq('HASH_MISMATCH tidak diulang & tidak memicu sync', r.calls, ['/jobs/0/deliverable']);

    r = await run([[429, { ok: false, code: 'RATE_LIMITED', error: 'x' }], [200, okBody]]);
    eq('RATE_LIMITED -> ulang sekali', r.calls, ['/jobs/0/deliverable', '/jobs/0/deliverable']);

    r = await run([[422, { ok: false, code: 'STRUCTURAL_FAILED', error: 'Konten terlalu pendek (minimal 40 karakter, dikirim 3)' }]]);
    check('STRUCTURAL_FAILED -> pesan server diteruskan, tanpa ulang', r.err instanceof ApiClientError && (r.err as ApiClientError).message.includes('minimal 40') && r.calls.length === 1);
  } finally {
    globalThis.fetch = realFetch;
    globalThis.setTimeout = realTimeout;
  }
}

// ---------------------------------------------------------
checkApiClient().then(checkSaveMetadata).then(checkDeliverablePost).then(() => {
  console.log('\n' + '-'.repeat(46));
  console.log(`  lulus: ${pass}   gagal: ${fail}`);
  process.exit(fail ? 1 : 0);
});
