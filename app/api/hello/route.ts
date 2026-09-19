import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { ok, handler } from '@/lib/http';

const TABLES = ['jobs', 'oracle_runs', 'activity', 'indexer_state'] as const;

/**
 * Health check: konfigurasi aktif + status koneksi ke tiap tabel.
 *
 * Sengaja hanya mengembalikan flag & jumlah baris — TIDAK PERNAH nilai key
 * apa pun. Detail error Supabase ikut ditampilkan karena endpoint ini memang
 * alat diagnosis saat setup; hapus atau perketat sebelum production.
 *
 * Kenapa error dilaporkan lengkap (code/details/hint/status), bukan cuma
 * message: pernah terjadi kegagalan transien dengan `message` KOSONG, dan
 * tanpa field lain tidak ada yang bisa ditelusuri sama sekali.
 */
export const GET = handler(async () => {
  const results = await Promise.all(
    TABLES.map(async (table) => {
      const res = await db()
        .from(table)
        .select('*', { count: 'exact', head: true });

      if (!res.error) return [table, { rows: res.count ?? 0 }] as const;

      return [
        table,
        {
          error: res.error.message || '(pesan kosong)',
          code: res.error.code || null,
          details: res.error.details || null,
          hint: res.error.hint || null,
          httpStatus: res.status,
        },
      ] as const;
    })
  );

  const tables = Object.fromEntries(results);
  const allOk = results.every(([, r]) => !('error' in r));

  return ok({
    service: 'geo-escrow-backend',
    phase: 'Fase 1 — Database',
    database: allOk ? 'connected' : 'error',
    tables,
    config: {
      oracleProvider: env.oracleProvider,
      chainEnabled: env.chainEnabled,
      cronSecretSet: env.cronSecret.length > 0,
    },
  });
});
