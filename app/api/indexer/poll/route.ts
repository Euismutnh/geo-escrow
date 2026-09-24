import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { runIndexer } from '@/lib/indexer';
import { reclaimStaleLocks } from '@/lib/jobs-repo';
import { verifyCronSecret } from '@/lib/validate';
import { ok, fail, handler } from '@/lib/http';

// Satu putaran memproses sampai 12 rentang blok. Beri ruang.
export const maxDuration = 60;

/**
 * GET /api/indexer/poll — jaring pengaman, dipanggil cron.
 *
 * Menangkap yang tidak lewat `POST /api/sync/:id`: user menutup tab
 * sebelum sync terkirim, transaksi dikirim dari Etherscan, atau event
 * yang bukan kita yang memicunya — `acceptJob` dari freelancer,
 * `arbiterDecide` dari juri, `reclaimExpired` dari client.
 *
 * TERTUTUP di balik CRON_SECRET. Berbeda dari `/api/sync/:id` yang
 * menyentuh satu job, endpoint ini menyisir ribuan blok sekaligus —
 * kalau terbuka, satu orang bisa membuat kita menembak RPC tanpa henti.
 * `verifyCronSecret` menolak kalau CRON_SECRET kosong, jadi lupa
 * mengisinya saat deploy berarti endpoint TERTUTUP, bukan terbuka.
 */
export const GET = handler(async (req: NextRequest) => {
  if (!verifyCronSecret(req.headers.get('authorization'))) {
    return fail('VALIDATION', 'Tidak berwenang');
  }

  if (!env.chainEnabled) {
    return fail(
      'WRONG_STATUS',
      'CHAIN_ENABLED=false — tidak ada blockchain untuk disusuri'
    );
  }

  const hasil = await runIndexer();

  // Sekalian bebaskan lock yang macet. Cron adalah satu-satunya hal yang
  // jalan tanpa diminta, jadi di sinilah tempatnya: job yang tertinggal
  // di `running_*` karena proses mati di tengah akan tergantung selamanya
  // kalau tidak ada yang memungutnya.
  const lockDibebaskan = await reclaimStaleLocks();

  return ok({ ...hasil, lockDibebaskan });
});
