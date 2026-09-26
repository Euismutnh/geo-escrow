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

/**
 * CSP HALAMAN (Fase 10) — varian "Without Nonces" dari
 * node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
 *
 * Kenapa tanpa nonce: nonce memaksa SEMUA halaman dirender dinamis per
 * request (panduan yang sama, "Dynamic Rendering Requirement") — halaman
 * kita sekarang statis dan ringan, dan mesin pengembangan ini terbatas RAM.
 * Konsekuensinya 'unsafe-inline' untuk skrip (bootstrap inline Next.js);
 * yang tetap ditutup: skrip dari domain lain, eval (produksi), object/embed,
 * <base>, form ke domain lain, dan pembingkaian oleh situs lain.
 *
 * connect-src: browser membaca chain LANGSUNG lewat RPC publik (wagmi) —
 * origin-nya diambil dari NEXT_PUBLIC_RPC_URL saat build, plus RPC bawaan
 * viem sebagai cadangan (lib/wagmi.ts memakainya kalau env kosong).
 * Wallet (Rabby/MetaMask) menyuntik provider lewat API ekstensi, yang tidak
 * tunduk pada CSP halaman — tetap WAJIB diuji dengan wallet terhubung.
 */
const isDev = process.env.NODE_ENV === 'development';
const origin = (url: string | undefined) => {
  try { return url ? new URL(url).origin : null; } catch { return null; }
};
const rpcOrigins = [
  origin(process.env.NEXT_PUBLIC_RPC_URL),
  'https://data-seed-prebsc-1-s1.bnbchain.org:8545', // RPC bawaan viem bscTestnet
].filter((o, i, a): o is string => !!o && a.indexOf(o) === i);

const cspHalaman = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  // data: = ikon wallet EIP-6963 (wajib data URI menurut spesifikasinya)
  "img-src 'self' data: blob:",
  "font-src 'self'", // next/font menyajikan font dari domain sendiri
  `connect-src 'self' ${rpcOrigins.join(' ')}${isDev ? ' ws: wss:' : ''}`, // ws: = HMR dev
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'", // selaras X-Frame-Options SAMEORIGIN
  // Hanya di hosting (Vercel = selalu HTTPS). Di `next start` lokal lewat
  // http://localhost, direktif ini memaksa aset ke HTTPS dan halaman rusak.
  ...(process.env.VERCEL === '1' ? ['upgrade-insecure-requests'] : []),
].join('; ');

/** /docs memuat Swagger UI dari cdnjs (app/docs/route.ts) — izin itu HANYA di sini. */
const CDNJS = 'https://cdnjs.cloudflare.com';
const cspDocs = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${CDNJS}`,
  `style-src 'self' 'unsafe-inline' ${CDNJS}`,
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join('; ');

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
        headers: [...headerDasar, ...headerProduksi, { key: 'Content-Security-Policy', value: cspHalaman }],
      },
      // Aturan yang lebih belakang MENIMPA key yang sama dari aturan di atas
      // (next.config headers) — /docs dan /api mendapat CSP-nya sendiri.
      {
        source: '/docs',
        headers: [{ key: 'Content-Security-Policy', value: cspDocs }],
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


export default nextConfig;
