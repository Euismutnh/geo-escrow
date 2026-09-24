/**
 * Verifikasi lapisan murni: types/hash/vrf/scoring/verdict/format/status
 * (Fase 2) + verifyCronSecret dari validate.ts (Fase 5).
 * Jalankan: npm run check
 */
import { decide, hitPerQuery, type RunHit } from '../lib/scoring';
import { parseJobIdParam } from '../lib/route-params';
import { api, apiPost, ApiClientError } from '../lib/api';
import { subsetSize, deriveSubset } from '../lib/vrf';
import { queryPoolHash, canonicalQueryPool, contentHash } from '../lib/hash';
import { verdictHash, type Verdict } from '../lib/verdict';
import { formatTBNB, toWei, shortAddr } from '../lib/format';
import { deriveUiStatus, UI_STATUS_META, type UiStatus, type UiStatusInput } from '../lib/status';
import { verifyCronSecret, parseJobId } from '../lib/validate';

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

// ---------------------------------------------------------
checkApiClient().then(() => {
  console.log('\n' + '-'.repeat(46));
  console.log(`  lulus: ${pass}   gagal: ${fail}`);
  process.exit(fail ? 1 : 0);
});
