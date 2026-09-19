/**
 * Verifikasi validasi input (Fase 6).
 * Jalankan: npm run check
 *
 * Semua fungsi di sini adalah gerbang pertama antara dunia luar dan
 * database kita -- tidak ada yang boleh lolos tanpa diperiksa.
 */
import {
  LIMITS,
  requireText,
  optionalText,
  requireWei,
  requireJobId,
  requireFutureDate,
  requireQueryPool,
} from '../lib/validate-input';
import { ApiError } from '../lib/http';
import { checkStructural, MIN_DELIVERABLE_LENGTH } from '../lib/structural';

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
function rejects(name: string, fn: () => unknown) {
  try {
    fn();
    check(name, false, 'diterima, padahal harus ditolak');
  } catch (e) {
    check(name, e instanceof ApiError, `melempar ${e instanceof Error ? e.name : typeof e}, bukan ApiError`);
  }
}
const section = (s: string) => console.log(`\n${s}`);

const FUTURE = new Date(Date.now() + 864e5).toISOString();
const PAST = new Date(Date.now() - 864e5).toISOString();

// ---------------------------------------------------------
section('requireJobId');
eq('0 diterima', requireJobId(0), 0);
eq('42 diterima', requireJobId(42), 42);
rejects('pecahan 1.5 ditolak', () => requireJobId(1.5));
rejects('negatif ditolak', () => requireJobId(-1));
rejects('NaN ditolak', () => requireJobId(NaN));
rejects('Infinity ditolak', () => requireJobId(Infinity));
// Di atas 2^53 angka tidak lagi eksak -- jobId harus cocok persis dengan
// on-chain, jadi nilai yang sudah kehilangan presisi tidak boleh masuk.
rejects('di atas 2^53 ditolak', () => requireJobId(2 ** 53 + 1));
rejects('string ditolak', () => requireJobId('7'));
rejects('null ditolak', () => requireJobId(null));

// ---------------------------------------------------------
section('requireText - batas panjang menjaga biaya & waktu');
eq('di-trim', requireText('  Teh Poci  ', 'brand', 100), 'Teh Poci');
eq('tepat di batas diterima', requireText('x'.repeat(100), 'brand', 100).length, 100);
rejects('lewat 1 karakter ditolak', () => requireText('x'.repeat(101), 'brand', 100));
rejects('spasi saja ditolak', () => requireText('   ', 'brand', 100));
rejects('kosong ditolak', () => requireText('', 'brand', 100));
rejects('number ditolak', () => requireText(123, 'brand', 100));
rejects('null ditolak', () => requireText(null, 'brand', 100));

section('optionalText');
eq('undefined -> null', optionalText(undefined, 'brief', 100), null);
eq('kosong -> null', optionalText('', 'brief', 100), null);
eq('terisi -> di-trim', optionalText('  halo  ', 'brief', 100), 'halo');
rejects('kepanjangan tetap ditolak', () => optionalText('x'.repeat(101), 'brief', 100));

// ---------------------------------------------------------
section('requireWei - presisi uang');
eq('string angka diterima', requireWei('20000000000000000', 'budgetWei'), '20000000000000000');
// Ini inti pertahanan presisi: number JS kehilangan digit di atas 2^53,
// dan nilai yang sudah rusak saat masuk tidak bisa diperbaiki lagi.
rejects('number ditolak (bukan string)', () => requireWei(20000000000000000, 'budgetWei'));
rejects('nol ditolak', () => requireWei('0', 'budgetWei'));
rejects('negatif ditolak', () => requireWei('-5', 'budgetWei'));
rejects('desimal ditolak', () => requireWei('1.5', 'budgetWei'));
rejects('huruf ditolak', () => requireWei('20e18', 'budgetWei'));
rejects('kosong ditolak', () => requireWei('', 'budgetWei'));
rejects('kelewat panjang ditolak', () => requireWei('9'.repeat(50), 'budgetWei'));

// ---------------------------------------------------------
section('requireFutureDate');
check('tanggal masa depan diterima', typeof requireFutureDate(FUTURE, 'deadline') === 'string');
eq('dinormalkan ke ISO', requireFutureDate(FUTURE, 'deadline'), new Date(FUTURE).toISOString());
rejects('masa lalu ditolak', () => requireFutureDate(PAST, 'deadline'));
// Tanpa penjaga ini, nilai sembarang langsung masuk ke kolom timestamptz
// dan Postgres yang menolaknya -- muncul sebagai 500, bukan 400.
rejects('bukan tanggal ditolak', () => requireFutureDate('besok pagi', 'deadline'));
rejects('kosong ditolak', () => requireFutureDate('', 'deadline'));
rejects('undefined ditolak', () => requireFutureDate(undefined, 'deadline'));

// ---------------------------------------------------------
section('requireQueryPool');
const Q3 = ['Pertanyaan satu?', 'Pertanyaan dua?', 'Pertanyaan tiga?'];
eq('3 pertanyaan + target 2', requireQueryPool(Q3, 2), { queries: Q3, targetCount: 2 });
eq('6 pertanyaan diterima', requireQueryPool([...Q3, 'empat?', 'lima?', 'enam?'], 3).queries.length, 6);
rejects('2 pertanyaan ditolak', () => requireQueryPool(Q3.slice(0, 2), 1));
rejects('7 pertanyaan ditolak', () => requireQueryPool([...Q3, 'd?', 'e?', 'f?', 'g?'], 3));
rejects('bukan array ditolak', () => requireQueryPool('a,b,c', 2));

// Kembar ditolak: hash tetap sah, tapi pengukurannya lemah (satu
// pertanyaan dihitung dua kali) DAN membayar panggilan AI dua kali
// untuk informasi yang sama.
rejects('kembar persis ditolak', () => requireQueryPool(['sama?', 'sama?', 'beda?'], 2));
rejects('kembar beda kapital ditolak', () => requireQueryPool(['Sama?', 'SAMA?', 'beda?'], 2));

rejects('target 0 ditolak', () => requireQueryPool(Q3, 0));
rejects('target > jumlah query ditolak', () => requireQueryPool(Q3, 4));
rejects('target pecahan ditolak', () => requireQueryPool(Q3, 1.5));
rejects('query kepanjangan ditolak', () => requireQueryPool(['x'.repeat(LIMITS.query + 1), 'b?', 'c?'], 2));
rejects('query kosong ditolak', () => requireQueryPool(['  ', 'b?', 'c?'], 2));

// ---------------------------------------------------------
section('checkStructural - gerbang sebelum freelancer bayar gas');
{
  const BRAND = 'Teh Poci';
  const cukupPanjang = (isi: string) => isi + ' '.repeat(0) + 'x'.repeat(Math.max(0, 60 - isi.length));

  const valid = 'Teh Poci adalah produsen teh melati kemasan asal Slawi yang sudah puluhan tahun.';
  check('konten valid lolos', checkStructural(valid, BRAND).pass);
  eq('konten valid tanpa reason', checkStructural(valid, BRAND).reason, undefined);

  // Syarat 1: panjang minimum
  const pendek = 'Teh Poci bagus';
  check('terlalu pendek ditolak', !checkStructural(pendek, BRAND).pass);
  eq('alasannya too_short', checkStructural(pendek, BRAND).reason, 'too_short');
  check('pesan menyebut jumlah karakter', checkStructural(pendek, BRAND).message!.includes('dikirim'));

  // Batas persis: 39 ditolak, 40 diterima (brand harus tetap ada)
  const pas39 = 'Teh Poci ' + 'a'.repeat(MIN_DELIVERABLE_LENGTH - 10);
  const pas40 = 'Teh Poci ' + 'a'.repeat(MIN_DELIVERABLE_LENGTH - 9);
  eq('panjang 39 -> ditolak', pas39.length, MIN_DELIVERABLE_LENGTH - 1);
  check('tepat di bawah batas ditolak', !checkStructural(pas39, BRAND).pass);
  eq('panjang 40 -> diterima', pas40.length, MIN_DELIVERABLE_LENGTH);
  check('tepat di batas diterima', checkStructural(pas40, BRAND).pass);

  // Syarat 2: brand harus disebut
  const tanpaBrand = cukupPanjang('Produk teh melati kemasan asal Slawi yang enak sekali rasanya');
  check('tanpa nama brand ditolak', !checkStructural(tanpaBrand, BRAND).pass);
  eq('alasannya brand_not_mentioned', checkStructural(tanpaBrand, BRAND).reason, 'brand_not_mentioned');

  // Syarat 2 bukan formalitas: isi ini jadi KONTEKS yang dibaca Oracle.
  // Kalau brandnya sendiri tidak ada, verifikasi hampir pasti gagal --
  // dan itu baru ketahuan setelah panggilan AI dibayar.
  check('beda kapital tetap lolos',
    checkStructural(valid.replace('Teh Poci', 'TEH POCI'), BRAND).pass);
  check('brand sebagai bagian kata lain TIDAK lolos',
    !checkStructural(cukupPanjang('Tehpocian adalah istilah yang sering dipakai orang Slawi'), BRAND).pass);

  // Spasi di ujung tidak boleh menipu pemeriksaan panjang
  check('spasi banyak tidak menambah panjang',
    !checkStructural('   Teh Poci   ' + ' '.repeat(100), BRAND).pass);
}

// ---------------------------------------------------------
console.log('\n' + '-'.repeat(46));
console.log(`  lulus: ${pass}   gagal: ${fail}`);
process.exit(fail ? 1 : 0);
