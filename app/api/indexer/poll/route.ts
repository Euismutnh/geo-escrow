import type { NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { runIndexer } from '@/lib/indexer';
import { reclaimStaleLocks } from '@/lib/jobs-repo';
import { sweepSubmitted } from '@/lib/flows/structural';
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

  const mulai = Date.now();
  let lockDibebaskan = 0;
  let hasil;
  try {
    hasil = await runIndexer();
  } finally {
    // Sekalian bebaskan lock yang macet — di `finally`, karena dulu baris
    // ini berada SETELAH runIndexer(): satu rentang yang gagal (RPC putus,
    // insert ditolak) membuat lock macet ikut tidak pernah dibebaskan.
    lockDibebaskan = await reclaimStaleLocks().catch((e) => {
      console.error('[poll] reclaimStaleLocks gagal:', e);
      return 0;
    });
  }

  // Job yang tertinggal di `Submitted` (tab ditutup sebelum sync). Hanya
  // kalau masih ada sisa waktu: satu konfirmasi bisa menunggu receipt
  // RECEIPT_TIMEOUT_MS (30 dtk) dan maxDuration route ini 60 dtk.
  const disapu = await sweepSubmitted({ max: 2, deadlineMs: mulai + 20_000 });
  if (disapu > 0) console.log(`[poll] ${disapu} job Submitted dicoba dikonfirmasi`);

  return ok({ ...hasil, lockDibebaskan });
});
