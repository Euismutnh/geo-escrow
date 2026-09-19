import { readChainInfo } from '@/lib/chain-server';
import { ok, handler } from '@/lib/http';

/**
 * GET /api/chain-info
 *
 * Konfigurasi tingkat-kontrak: alamat oracle, arbiter, owner, dan
 * konstanta bond/structural.
 *
 * Ini PENGGANTI kolom `jobs.arbiter_addr` yang dihapus di migrasi 01.
 * FE memakainya untuk memutuskan kapan panel juri ditampilkan:
 *
 *     const { arbiter } = await fetch('/api/chain-info').then(r => r.json());
 *     const bolehMemutus = walletAktif?.toLowerCase() === arbiter?.toLowerCase();
 *
 * Semua nilainya publik (siapa pun bisa membacanya dari blockchain),
 * jadi endpoint ini tidak butuh autentikasi. Hasilnya di-cache 60 detik
 * di sisi server -- lihat readChainInfo().
 */
export const GET = handler(async () => {
  return ok(await readChainInfo());
});
