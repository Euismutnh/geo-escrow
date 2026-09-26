import type { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { parseAddress } from '@/lib/validate';
import { ok, handler, internalError } from '@/lib/http';

const DONE: string[] = ['ReleasedFull', 'Refunded'];

/**
 * GET /api/stats?wallet=0x...
 *
 * Empat angka untuk halaman Ringkasan. Keempat query dijalankan
 * BERSAMAAN lewat Promise.all, bukan berurutan.
 *
 * head: true = minta hitungannya saja, jangan kirim barisnya.
 */
export const GET = handler(async (req: NextRequest) => {
  // parseAddress() menolak apa pun yang bukan /^0x[0-9a-f]{40}$/,
  // sehingga alamat aman diinterpolasi ke filter .or() di bawah.
  const wallet = parseAddress(req.nextUrl.searchParams.get('wallet'));
  const zero = Promise.resolve(0);

  const count = async (
    apply: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>
  ): Promise<number> => {
    const { count: c, error } = await apply(baseQuery());
    if (error) throw internalError('menghitung statistik', error);
    return c ?? 0;
  };

  const [asClient, asFreelancer, needJury, done] = await Promise.all([
    wallet ? count((q) => q.eq('client_addr', wallet)) : zero,
    wallet ? count((q) => q.eq('freelancer_addr', wallet)) : zero,
    count((q) => q.eq('status', 'Disputed')),
    wallet
      ? count((q) =>
          q
            .or(`client_addr.eq.${wallet},freelancer_addr.eq.${wallet}`)
            .in('status', DONE)
        )
      : zero,
  ]);

  return ok({ asClient, asFreelancer, needJury, done });
});

function baseQuery() {
  return db().from('jobs').select('*', { count: 'exact', head: true });
}
