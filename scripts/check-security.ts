/**
 * Audit keamanan sebelum deploy — checklist §11.2 yang BERJALAN.
 *
 * Jalankan: npx tsx scripts/check-security.ts
 *
 * Checklist yang ditandai manusia akan dicentang tanpa dibaca, cepat atau
 * lambat. Yang di sini diperiksa mesin, dan yang tidak bisa diperiksa
 * mesin disebut terang-terangan di bagian akhir supaya tidak menyamar
 * jadi "aman".
 *
 * TIDAK ADA nilai rahasia yang dicetak skrip ini — hanya ada/tidaknya,
 * panjangnya, atau bentuknya. Keluarannya aman ditempel ke chat tim.
 */
process.loadEnvFile('.env.local');
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

let lulus = 0;
let gagal = 0;
let peringatan = 0;

function cek(nama: string, benar: boolean, detail = '') {
  if (benar) {
    lulus++;
    console.log(`  ok    ${nama}`);
  } else {
    gagal++;
    console.log(`  GAGAL ${nama}${detail ? `\n          ${detail}` : ''}`);
  }
}

function warn(nama: string, aman: boolean, detail = '') {
  if (aman) {
    lulus++;
    console.log(`  ok    ${nama}`);
  } else {
    peringatan++;
    console.log(`  !     ${nama}${detail ? `\n          ${detail}` : ''}`);
  }
}

/** Semua file di bawah dir, rekursif. */
function berkas(dir: string, hasil: string[] = []): string[] {
  for (const nama of readdirSync(dir)) {
    if (nama === 'node_modules' || nama === '.next' || nama === '.git') continue;
    const p = join(dir, nama);
    if (statSync(p).isDirectory()) berkas(p, hasil);
    else hasil.push(p);
  }
  return hasil;
}

function git(perintah: string): string {
  try {
    return execSync(perintah, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

// ══════════════════════════════════════════════════════════════════

console.log('\nAudit keamanan sebelum deploy\n');

// ── 1. Rahasia tidak boleh punya awalan NEXT_PUBLIC_ ──────────────
console.log('1. Awalan NEXT_PUBLIC_ pada rahasia');
{
  // NEXT_PUBLIC_ membuat nilainya ikut ter-bundle ke JavaScript browser.
  // Untuk service_role key itu berarti akses admin penuh ke database,
  // dibagikan ke setiap pengunjung.
  const terlarang = [
    'NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_SERVICE_ROLE_KEY',
    'NEXT_PUBLIC_ORACLE_PRIVATE_KEY',
    'NEXT_PUBLIC_ANTHROPIC_API_KEY',
    'NEXT_PUBLIC_CRON_SECRET',
  ];
  const ada = terlarang.filter((k) => process.env[k]);
  cek(
    'tidak ada rahasia berawalan NEXT_PUBLIC_',
    ada.length === 0,
    ada.length ? `ditemukan: ${ada.join(', ')} — HAPUS sekarang juga` : ''
  );

  // Cari juga di seluruh source, bukan cuma di env yang sedang termuat:
  // seseorang bisa menuliskannya langsung di kode.
  const sumber = berkas('.').filter(
    (f) => /\.(ts|tsx|js|jsx|mjs)$/.test(f) && !f.includes('check-security')
  );
  const bocor = sumber.filter((f) =>
    /NEXT_PUBLIC_[A-Z_]*(SERVICE_ROLE|PRIVATE_KEY|SECRET|ANTHROPIC)/.test(
      readFileSync(f, 'utf8')
    )
  );
  cek('tidak ada di source code', bocor.length === 0, bocor.join('\n          '));
}

// ── 1b. anon key & RLS ────────────────────────────────────────────
console.log('\n1b. Supabase anon key / RLS');
{
  // Keputusan §3.3: kita memakai polling, bukan Realtime, jadi anon key
  // tidak dipakai di mana pun dan RLS sengaja TIDAK dinyalakan.
  //
  // Keduanya terikat. Begitu anon key dipakai dari browser, RLS jadi
  // satu-satunya yang memisahkan data antar-pengguna — dan tanpa RLS,
  // anon key berarti SIAPA PUN bisa membaca seluruh tabel. Jadi anon key
  // yang terisi saat RLS mati adalah kombinasi paling berbahaya yang
  // bisa terjadi di proyek ini.
  const anon = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
  cek(
    'anon key kosong (konsisten dengan keputusan polling, §3.3)',
    anon.length === 0,
    'Terisi. Kalau Realtime memang jadi dipakai, RLS WAJIB dinyalakan lebih\n          dulu di Supabase — tanpa itu anon key membuka seluruh tabel untuk publik.'
  );

  const sumber = berkas('lib')
    .concat(berkas('app'))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));
  const pakaiAnon = sumber.filter((f) =>
    /NEXT_PUBLIC_SUPABASE_ANON_KEY/.test(readFileSync(f, 'utf8'))
  );
  cek('anon key tidak dirujuk kode mana pun', pakaiAnon.length === 0, pakaiAnon.join(', '));
}

// ── 2. Private key tidak boleh punya NILAI di file yang dilacak git ──
console.log('\n2. Rahasia di dalam repo');
{
  const dilacak = git('git ls-files').split('\n').filter(Boolean);

  // Yang berbahaya bukan "ada baris ORACLE_PRIVATE_KEY" — melainkan baris
  // itu punya NILAI. Baris kosong justru pola yang benar: variabelnya
  // terdokumentasi, isinya diisi di panel hosting.
  const berisiKunci: string[] = [];
  for (const f of dilacak) {
    let isi: string;
    try {
      isi = readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    // Harus DUA-DUANYA di satu baris: nama yang berbau kunci, DAN nilai
    // 64-hex sungguhan.
    //
    // Versi pertama pemeriksaan ini mencari 64-hex di mana saja, dan
    // langsung menuduh dua berkas yang tidak bersalah: hash verdict,
    // queryPoolHash, dan seed VRF semuanya bytes32 — bentuknya identik
    // dengan private key. Pemeriksaan yang berteriak untuk hal normal
    // akan diabaikan orang, dan kebocoran sungguhan ikut terlewat
    // bersamanya.
    const pola =
      /(PRIVATE_KEY|privateKey|MNEMONIC|mnemonic|SECRET_KEY)\s*[=:]\s*['"`]?(0x)?[0-9a-fA-F]{64}\b/;
    if (pola.test(isi)) berisiKunci.push(f);
  }
  cek(
    'tidak ada private key ber-NILAI di file yang dilacak git',
    berisiKunci.length === 0,
    berisiKunci.length
      ? `${berisiKunci.join(', ')}\n          Kunci wallet TIDAK bisa dirotasi lewat dashboard — satu-satunya\n          perbaikan adalah owner memanggil setOracle() ke wallet baru.`
      : ''
  );

  // .env.local: keputusan tim adalah ikut di-commit supaya teman satu tim
  // bisa membacanya (repo privat). Jadi ini peringatan, bukan kegagalan —
  // yang wajib tetap: kunci wallet-nya kosong (diperiksa di atas).
  const envDilacak = dilacak.some((f) => /^\.env(\.|$)/.test(f));
  warn(
    '.env.local tidak ikut dilacak git',
    !envDilacak,
    envDilacak
      ? 'Ikut dilacak — ini keputusan tim (repo privat, kolaborasi).\n          Pastikan repo TIDAK PERNAH dijadikan publik: riwayat git\n          menyimpan nilai lama walau file-nya nanti dihapus.'
      : ''
  );
}

// ── 3. Semua route dibungkus handler() ────────────────────────────
console.log('\n3. Kebocoran pesan error');
{
  // Cakupannya SELURUH app/, bukan cuma app/api.
  //
  // Sempat kupersempit ke app/api supaya app/docs/route.ts (HTML statis)
  // tidak jadi kegagalan palsu — tapi itu membuka lubang: route di luar
  // app/api yang menyentuh database jadi tidak ikut diperiksa.
  //
  // Aturannya sekarang mengikuti RISIKO, bukan lokasi: sebuah route wajib
  // memakai handler() kalau ia di bawah app/api, ATAU menyentuh database.
  // Route yang cuma menyajikan HTML statis tidak punya pesan error yang
  // bisa membocorkan apa pun.
  const semuaRoute = berkas('app').filter((f) => f.endsWith('route.ts'));

  const menyentuhData = (isi: string) =>
    /from '@\/lib\/(db|jobs-repo)'|@supabase\/supabase-js/.test(isi);

  const wajib = semuaRoute.filter((f) => {
    const jalur = f.replace(/\\/g, '/');
    return jalur.startsWith('app/api') || menyentuhData(readFileSync(f, 'utf8'));
  });

  const telanjang = wajib.filter((f) => !readFileSync(f, 'utf8').includes('handler('));
  const dikecualikan = semuaRoute.length - wajib.length;

  cek(
    `route berisiko (${wajib.length}) memakai handler()` +
      (dikecualikan > 0 ? ` — ${dikecualikan} route statis dikecualikan` : ''),
    telanjang.length === 0,
    telanjang.length
      ? `${telanjang.join('\n          ')}\n          Tanpa handler(), stack trace dan pesan mentah Postgres ikut terkirim ke client.`
      : ''
  );

  // handler() hanya menyembunyikan error yang BUKAN ApiError. Pesan mentah
  // yang dibungkus sendiri ke ApiError/fail() — atau ditulis ke last_error,
  // yang terbaca publik lewat GET /api/jobs/:id — tetap bocor. Pesan viem
  // memuat URL RPC lengkap (dan kuncinya, kalau penyedia RPC menaruh
  // kunci di URL).
  //
  // /api/dev/seed dikecualikan: route dev, mati di produksi (bagian 4).
  const POLA_BOCOR: [string, RegExp][] = [
    ["ApiError('INTERNAL', <x>.message)", /ApiError\(\s*'INTERNAL'\s*,\s*[\w.]*\.message/],
    ["fail('INTERNAL', <x>.message)", /fail\(\s*'INTERNAL'\s*,\s*[\w.]*\.message/],
    ["fail(<kode>, e instanceof Error ? e.message …)", /fail\([^)]*instanceof Error \? \w+\.message/],
    ['releaseLock(…, e.message) -> last_error mentah', /releaseLock\([^;]*\.message/],
    ['OracleError(e.message) -> dianggap aman padahal mentah', /new OracleError\(\s*\w+ instanceof Error \? \w+\.message/],
    ['pesan error disisipkan ke template string', /\$\{\s*\w+ instanceof Error \? \w+\.message/],
  ];
  const kodeServer = [...berkas('lib'), ...berkas('app')].filter(
    (f) => /\.tsx?$/.test(f) && !f.replace(/\\/g, '/').startsWith('app/api/dev/')
  );
  const temuan: string[] = [];
  for (const f of kodeServer) {
    const baris = readFileSync(f, 'utf8').split('\n');
    baris.forEach((b, i) => {
      if (/^\s*(\*|\/\/)/.test(b)) return; // komentar & JSDoc
      for (const [nama, re] of POLA_BOCOR) if (re.test(b)) temuan.push(`${f}:${i + 1}  ${nama}`);
    });
  }
  cek(
    'tidak ada pesan error mentah yang dibungkus ke respons / last_error',
    temuan.length === 0,
    temuan.length
      ? `${temuan.join('\n          ')}\n          Pakai internalError() / publicErrorMessage() dari lib/http.ts.`
      : ''
  );
}

// ── 4. Endpoint dev tidak boleh hidup di produksi ─────────────────
console.log('\n4. Endpoint pengembangan');
{
  const seed = 'app/api/dev/seed/route.ts';
  let isi = '';
  try {
    isi = readFileSync(seed, 'utf8');
  } catch {
    /* sudah dihapus — itu juga aman */
  }
  cek(
    'POST /api/dev/seed menolak jalan di produksi',
    !isi || /isProduction|NODE_ENV/.test(isi),
    'Seed menulis data palsu. Tanpa penjaga, siapa pun bisa menimpa database produksi.'
  );
}

// ── 5. CRON_SECRET ────────────────────────────────────────────────
console.log('\n5. CRON_SECRET');
{
  const s = (process.env.CRON_SECRET ?? '').trim();
  cek('terisi', s.length > 0, 'Kosong berarti /api/indexer/poll TERTUTUP total — indexer tidak akan pernah jalan.');
  warn(
    'bukan nilai contoh bawaan',
    s !== 'dev-secret-ganti-sebelum-deploy',
    'Masih memakai nilai dari blueprint. Wajib diganti sebelum deploy.'
  );
  warn('panjang >= 24 karakter', s.length >= 24, `panjangnya ${s.length}`);
}

// ── 6. Presisi wei ────────────────────────────────────────────────
console.log('\n6. Presisi nilai wei');
{
  // Number() pada nilai wei kehilangan presisi di atas 2^53 (~0,009 tBNB).
  // Bukan bug yang terlihat: angkanya cuma meleset beberapa wei, dan
  // perbandingan dengan nilai on-chain jadi gagal tanpa sebab yang jelas.
  const sumber = berkas('lib')
    .concat(berkas('app'))
    .filter((f) => f.endsWith('.ts'));
  const tersangka: string[] = [];
  for (const f of sumber) {
    const baris = readFileSync(f, 'utf8').split('\n');
    baris.forEach((b, i) => {
      if (/Number\([^)]*_wei/.test(b)) tersangka.push(`${f}:${i + 1}`);
    });
  }
  cek(
    'tidak ada Number() pada nilai wei',
    tersangka.length === 0,
    tersangka.join('\n          ')
  );
}

// ── 7. Data seed vs jobId on-chain ────────────────────────────────
console.log('\n7. Tabrakan jobId');
{
  let isi = '';
  try {
    isi = readFileSync('app/api/dev/seed/route.ts', 'utf8');
  } catch {
    /* sudah dihapus */
  }
  const id = [...isi.matchAll(/job_id:\s*(\d+)/g)].map((m) => Number(m[1]));
  const bentrok = id.filter((n) => n < 100);
  warn(
    'data seed tidak memakai jobId rendah',
    bentrok.length === 0,
    bentrok.length
      ? `seed memakai job_id ${bentrok.join(', ')} — job on-chain mulai dari 0,\n          jadi keduanya akan bertabrakan. Hapus seed sebelum CHAIN_ENABLED=true.`
      : ''
  );
}

// ── 8. Konsistensi konfigurasi rantai ─────────────────────────────
console.log('\n8. Konfigurasi rantai');
{
  const chain = process.env.CHAIN_ENABLED === 'true';
  const key = (process.env.ORACLE_PRIVATE_KEY ?? '').trim();

  warn(
    'CHAIN_ENABLED=true',
    chain,
    'Masih false. Di produksi, POST /api/jobs akan MENOLAK jalan (interlock Fase 6) —\n          itu memang disengaja, tapi berarti aplikasinya belum bisa dipakai.'
  );

  warn(
    'ORACLE_PRIVATE_KEY terisi',
    key.length > 0,
    'Kosong. Jalur baca tetap jalan; yang gagal hanya saat uang harus berpindah.\n          Verifikasi akan selesai lalu berhenti di job_state=error, dan bisa\n          dilanjutkan tanpa panggilan AI baru begitu kuncinya masuk.'
  );

  if (key) {
    cek(
      'bentuk private key sah (64 hex)',
      /^(0x)?[0-9a-fA-F]{64}$/.test(key),
      'Bukan 64 karakter heksadesimal. Periksa apakah yang tersalin itu ALAMAT wallet.'
    );
  }

  cek('RPC_URL terisi', !!process.env.RPC_URL);

  // Fase 5: browser membaca chain lewat NEXT_PUBLIC_RPC_URL — nilainya
  // TER-BUNDLE ke JavaScript publik. RPC_URL server memuat kunci (URL
  // lengkapnya pernah bocor lewat pesan viem, temuan A21); menyalinnya ke
  // variabel publik membagikan kunci itu ke setiap pengunjung.
  // Yang dilarang bukan "nilainya sama" — publicnode tanpa kunci boleh
  // dipakai keduanya — tapi URL BERKUNCI (path, query, atau user:pass —
  // bentuk umum kunci penyedia RPC berbayar) yang tersalin ke variabel publik.
  const pub = (process.env.NEXT_PUBLIC_RPC_URL ?? '').trim();
  const priv = (process.env.RPC_URL ?? '').trim();
  const parse = (s: string) => { try { return new URL(s); } catch { return null; } };
  const keyed = (u: URL | null) => !!u && (u.pathname.length > 1 || u.search.length > 0 || !!u.username || !!u.password);
  warn('NEXT_PUBLIC_RPC_URL terisi', !!pub, 'Kosong — wallet & saldo di browser memakai RPC bawaan viem, yang sering kena rate limit.');
  if (pub) {
    const a = parse(pub), b = parse(priv);
    cek('NEXT_PUBLIC_RPC_URL sah & https', a?.protocol === 'https:', 'Bukan URL https yang sah.');
    cek('NEXT_PUBLIC_RPC_URL tidak menyalin RPC_URL berkunci', !(keyed(b) && a && b && a.host === b.host && a.pathname === b.pathname && a.search === b.search),
      'Sama dengan RPC_URL server yang memuat path/kunci — URL itu akan ter-bundle ke browser. Pakai RPC publik tanpa kunci.');
    warn('NEXT_PUBLIC_RPC_URL tanpa path/query/kredensial', !keyed(a),
      'URL publik memuat path, query, atau user:pass. Kalau itu kunci, siapa pun bisa membacanya dari bundle JavaScript.');
  }
  cek('GEO_ESCROW_ADDRESS terisi', !!process.env.GEO_ESCROW_ADDRESS);
  warn(
    'RPC_URL bukan drpc',
    !(process.env.RPC_URL ?? '').includes('drpc.org'),
    'drpc menolak setiap eth_getLogs — indexer akan gagal tanpa satu event pun masuk.'
  );
}

// ── 9. Header keamanan terpasang di konfigurasi ───────────────────
console.log('\n9. Header keamanan');
{
  const cfg = readFileSync('next.config.ts', 'utf8');
  cek('X-Content-Type-Options: nosniff', cfg.includes('nosniff'));
  cek('Referrer-Policy', cfg.includes('Referrer-Policy'));
  cek(
    'Cache-Control no-store untuk /api',
    cfg.includes('no-store'),
    'Tanpa ini, CDN bisa menyimpan jawaban /api/jobs?wallet=... milik satu wallet\n          lalu menyodorkannya ke wallet lain.'
  );
  cek('poweredByHeader dimatikan', /poweredByHeader:\s*false/.test(cfg));

  const proxyAda = (() => {
    try {
      readFileSync('proxy.ts', 'utf8');
      return true;
    } catch {
      return false;
    }
  })();
  cek('proxy.ts ada (bukan middleware.ts yang deprecated)', proxyAda);
  warn(
    'ALLOWED_ORIGINS kosong (FE same-origin)',
    !(process.env.ALLOWED_ORIGINS ?? '').trim(),
    `Terisi: ${process.env.ALLOWED_ORIGINS}. Pastikan tiap origin memang milikmu.`
  );
}

// ══════════════════════════════════════════════════════════════════

console.log('\n----------------------------------------------');
console.log(`  lulus: ${lulus}   gagal: ${gagal}   peringatan: ${peringatan}\n`);

console.log('  Yang TIDAK bisa diperiksa skrip ini — periksa sendiri:');
console.log('   - Saldo tBNB wallet oracle > 0  (npx tsx scripts/dev-chain-read.ts)');
console.log('   - Env var sudah diisi di panel hosting, bukan cuma di .env.local');
console.log('   - Header benar-benar terkirim setelah deploy:');
console.log('       curl -sI https://<app>/api/stats | grep -i "cache-control\\|nosniff"');
console.log('   - Putaran pertama /api/indexer/poll: blokDilompati harus jadi 0 di putaran kedua\n');

if (gagal > 0) process.exitCode = 1;
