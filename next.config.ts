import type { NextConfig } from 'next';

/**
 * Header keamanan dipasang DI SINI, bukan di proxy.ts.
 *
 * Tiga alasan, semuanya dari dokumentasi Next.js 16 yang terpasang:
 *
 * 1. Urutan eksekusi: `headers` dari next.config berjalan pada langkah 1,
 *    proxy baru pada langkah 3. Header yang dipasang di sini tidak bisa
 *    terlewat karena matcher yang keliru.
 *
 * 2. "Proxy should be used when you need access to request data or more
 *    complex logic." Header ini statis — tidak satu pun membaca request.
 *
 * 3. Berlaku untuk SEMUA respons termasuk aset statis, tanpa membuat
 *    proxy ikut jalan di tiap permintaan gambar dan CSS.
 */
const headerDasar = [
  // Jangan menebak tipe konten. Satu-satunya nilai yang sah: nosniff.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Jangan bocorkan path lengkap (yang memuat jobId, alamat wallet) ke
  // situs lain lewat header Referer.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
];

/**
 * HSTS hanya di produksi.
 *
 * Kalau ikut terpasang saat pengembangan, browser akan mengingat
 * "localhost wajib HTTPS" selama dua tahun — dan dev server yang HTTP
 * jadi tidak bisa dibuka sampai kamu membersihkannya manual lewat
 * chrome://net-internals/#hsts. Kegagalan yang sangat membingungkan
 * karena tidak ada yang berubah di kode.
 */
const headerProduksi =
  process.env.NODE_ENV === 'production'
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=63072000; includeSubDomains; preload',
        },
      ]
    : [];

const nextConfig: NextConfig = {
  // Jangan umumkan framework + versinya ke setiap pemindai.
  poweredByHeader: false,

  experimental: {
    // Mesin pengembangan 3,88 GB RAM, sering < 1 GB bebas, dan dev server
    // pernah OOM. Bawaannya, server memuat modul SETIAP halaman ke memori
    // saat start; dengan ini modul baru dimuat saat halamannya diminta.
    // Sumber: node_modules/next/dist/docs/01-app/02-guides/memory-usage.md
    //
    // Sengaja TIDAK memakai webpackMemoryOptimizations: Next.js 16 memakai
    // Turbopack secara default, jadi opsi khusus Webpack itu tidak berefek.
    preloadEntriesOnStart: false,
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [...headerDasar, ...headerProduksi],
      },
      {
        source: '/api/:path*',
        headers: [
          // PALING PENTING DI FILE INI.
          //
          // `GET /api/jobs?wallet=0x...` mengembalikan data yang berbeda
          // per wallet. Kalau CDN sempat menyimpannya, wallet berikutnya
          // yang meminta URL serupa bisa menerima jawaban milik orang
          // lain. Tidak ada satu pun respons API di sini yang layak
          // di-cache: semuanya spesifik-pengguna atau data rantai hidup.
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          // Respons API selalu JSON. CSP seketat ini aman untuk JSON dan
          // menutup kemungkinan browser memperlakukannya sebagai dokumen.
          {
            key: 'Content-Security-Policy',
            value: "default-src 'none'; frame-ancestors 'none'; sandbox",
          },
        ],
      },
    ];
  },
};

// CSP untuk HALAMAN sengaja BELUM dipasang. CSP yang ketat butuh nonce
// per-request, dan memasangnya sebelum frontend ada hampir pasti akan
// memblokir skrip wagmi/RainbowKit dengan pesan yang sulit dilacak.
// Kerjakan saat halaman sudah jadi, pakai panduan
// node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md

export default nextConfig;
