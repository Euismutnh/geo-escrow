import { openApiSpec } from '@/lib/openapi';

/**
 * Swagger UI — disajikan sebagai HTML mentah, bukan komponen React.
 *
 * Versi pertama halaman ini adalah `page.tsx` biasa, dan React menolaknya:
 *
 *   "Encountered a script tag while rendering React component. Scripts
 *    inside React components are never executed when rendering on the
 *    client."
 *
 * Swagger UI bukan komponen React — ia pustaka yang memasang dirinya ke
 * sebuah elemen DOM. Membungkusnya dengan React berarti melawan dua arah
 * sekaligus: hidrasi yang tidak diinginkan, dan skrip yang tidak jalan.
 * Route handler mengembalikan HTML apa adanya, jadi tidak ada hidrasi,
 * tidak ada peringatan, dan tidak ada dependensi baru.
 *
 * UI-nya dimuat dari CDN, bukan `npm i swagger-ui-react`: paket itu
 * menarik React-nya sendiri dan sering bentrok dengan React bawaan
 * Next.js 16 — dan bundelnya berat untuk mesin yang sudah pernah
 * kehabisan memori saat Turbopack mengompilasi.
 */

const SWAGGER_VERSION = '5.17.14';
const CDN = `https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/${SWAGGER_VERSION}`;

export async function GET() {
  // `</script>` di dalam string JSON akan menutup tag <script> lebih awal
  // dan merusak halaman. Melolosi `<` menutup kemungkinan itu sekaligus
  // mencegah injeksi kalau suatu saat spec memuat teks dari luar.
  const spec = JSON.stringify(openApiSpec).replace(/</g, '\\u003c');

  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GEO Escrow — Dokumentasi API</title>
<link rel="stylesheet" href="${CDN}/swagger-ui.min.css">
<style>
  body { margin: 0; background: #fafafa; }
  .topbar { display: none; }
  #gagal { display: none; font: 14px/1.6 system-ui, sans-serif; padding: 24px; color: #b91c1c; }
</style>
</head>
<body>
<div id="swagger-ui"></div>
<div id="gagal">
  <strong>Gagal memuat Swagger UI dari CDN.</strong><br>
  Halaman ini butuh internet untuk mengambil tampilannya — tapi API-nya
  sendiri tidak. Kalau sedang offline, pakai <code>api.http</code> atau
  skrip di <code>scripts/</code>.
</div>
<script src="${CDN}/swagger-ui-bundle.min.js"></script>
<script>
(function () {
  if (!window.SwaggerUIBundle) {
    document.getElementById('gagal').style.display = 'block';
    return;
  }
  window.SwaggerUIBundle({
    spec: ${spec},
    dom_id: '#swagger-ui',
    deepLinking: true,
    tryItOutEnabled: true,
    persistAuthorization: true,
    // Urutan mengikuti spec (alur kerja), bukan abjad.
    operationsSorter: null,
    tagsSorter: null,
    defaultModelsExpandDepth: -1,
  });
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // Spec ikut tertanam di HTML, jadi halaman ini berubah setiap kali
      // endpoint berubah. Jangan sampai browser menyodorkan versi lama.
      'Cache-Control': 'no-store',
    },
  });
}
