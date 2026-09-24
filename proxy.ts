import { NextResponse, type NextRequest } from 'next/server';

/**
 * Proxy — pengganti `middleware.ts` yang deprecated di Next.js 16.
 * Nama file DAN nama export sama-sama berubah.
 *
 * File ini sengaja hanya mengurus SATU hal: CORS. Itu satu-satunya
 * bagian pengerasan yang benar-benar butuh membaca request (header
 * `Origin`); sisanya — nosniff, Referrer-Policy, HSTS, Cache-Control —
 * ada di next.config.ts, yang berjalan lebih dulu dan tidak bisa
 * terlewat karena matcher yang keliru.
 *
 * YANG TIDAK ADA DI SINI: rate limit global.
 *
 * Rancangan awal menaruhnya di sini. Itu keliru, dan dokumentasi Next.js
 * menyebutnya eksplisit:
 *
 *   "Proxy is meant to be invoked separately of your render code and in
 *    optimized cases deployed to your CDN [...] you should not attempt
 *    relying on shared modules or globals."
 *
 * `lib/rate-limit.ts` menyimpan hitungannya di Map tingkat-modul. Di
 * proxy, Map itu bukan Map yang sama dengan milik route handler, dan
 * bisa berbeda per node CDN. Hasilnya bukan rate limit — hanya rasa
 * aman yang palsu. Pembatasan yang sungguhan tetap di route masing-masing
 * (POST /api/jobs, POST /api/sync/:id), dan pertahanan sebenarnya untuk
 * pekerjaan Oracle adalah lock atomik di database.
 */

/**
 * Origin yang boleh memanggil API dari halaman lain.
 *
 * KOSONG = tidak ada, dan itu default yang benar: frontend kita disajikan
 * Next.js yang sama dengan API-nya, jadi permintaannya same-origin dan
 * tidak pernah melewati CORS sama sekali. Header izin tanpa kebutuhan
 * hanya memperluas permukaan serangan.
 *
 * Isi hanya kalau FE benar-benar dideploy terpisah:
 *   ALLOWED_ORIGINS=https://geo-escrow.vercel.app,http://localhost:5173
 */
function originYangDiizinkan(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, '')) // garis miring di ujung tidak pernah ikut di header Origin
    .filter(Boolean);
}

const METODE = 'GET, POST, OPTIONS';
const HEADER = 'Content-Type, Authorization';

export function proxy(req: NextRequest) {
  const origin = req.headers.get('origin');
  const daftar = originYangDiizinkan();

  // Tidak ada Origin = permintaan same-origin, atau dari curl/REST Client.
  // Keduanya tidak butuh header CORS apa pun.
  if (!origin) return NextResponse.next();

  const diizinkan = daftar.includes(origin);

  // Preflight harus dijawab tuntas di sini — kalau diteruskan ke route,
  // handler kita tidak punya export OPTIONS dan browser akan menerima 405
  // lalu membatalkan permintaan aslinya.
  if (req.method === 'OPTIONS') {
    const h = new Headers({
      'Access-Control-Allow-Methods': METODE,
      'Access-Control-Allow-Headers': HEADER,
      // Preflight tidak perlu diulang tiap permintaan.
      'Access-Control-Max-Age': '86400',
    });
    if (diizinkan) {
      h.set('Access-Control-Allow-Origin', origin);
      // Jawaban preflight BERBEDA per origin. Tanpa Vary, cache bisa
      // menyodorkan izin milik origin lain.
      h.set('Vary', 'Origin');
    }
    // Origin tak dikenal tetap dapat 204, tapi TANPA Allow-Origin —
    // browser yang menolaknya, dan pesannya jelas di console.
    return new NextResponse(null, { status: 204, headers: h });
  }

  const res = NextResponse.next();
  if (diizinkan) {
    res.headers.set('Access-Control-Allow-Origin', origin);
    res.headers.set('Vary', 'Origin');
  }
  return res;
}

// Hanya API. Tanpa matcher, proxy ikut jalan di tiap permintaan gambar,
// CSS, dan file di public/ -- kerja sia-sia di jalur terpanas aplikasi.
export const config = { matcher: '/api/:path*' };
