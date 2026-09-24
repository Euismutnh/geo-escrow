/**
 * Tulis spec OpenAPI ke openapi.json — untuk diimpor ke Postman/Insomnia.
 *
 * Jalankan:  npm run openapi
 *            npm run openapi -- https://geo-escrow.vercel.app/api
 *
 * Halaman /docs menanam spec langsung ke HTML-nya, jadi tidak butuh file
 * ini. Postman butuh: ia mengimpor dari berkas atau URL, bukan dari
 * halaman yang sudah dirender.
 *
 * Bedanya satu hal: `servers` di spec aslinya relatif (`/api`), supaya
 * Swagger UI menembak server yang sedang dibuka. Postman tidak punya
 * "server yang sedang dibuka" — URL relatif di sana jadi tidak bisa
 * dipanggil sama sekali. Karena itu di sini diganti absolut.
 */
import { writeFileSync } from 'node:fs';
import { openApiSpec } from '../lib/openapi';

const BASE = process.argv[2] ?? 'http://localhost:3000/api';
const KELUARAN = 'openapi.json';

const spec = {
  ...openApiSpec,
  servers: [
    { url: BASE, description: 'Server yang dituju Postman' },
  ],
};

writeFileSync(KELUARAN, JSON.stringify(spec, null, 2));

const jumlahPath = Object.keys(spec.paths).length;
const jumlahOperasi = Object.values(spec.paths).reduce(
  (n, p) => n + Object.keys(p).length,
  0
);

console.log(`\n  ${KELUARAN} ditulis`);
console.log(`  server    ${BASE}`);
console.log(`  path      ${jumlahPath}`);
console.log(`  operasi   ${jumlahOperasi}\n`);
console.log('  Postman -> Import -> pilih berkas openapi.json\n');
console.log('  Endpoint bergembok (/indexer/poll, /jobs/:id/baseline) butuh');
console.log('  header Authorization: Bearer <CRON_SECRET>. Di Postman, isi');
console.log('  di tab Authorization -> Bearer Token, level Collection.\n');
