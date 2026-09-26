import type { Metadata } from 'next';
import { MarketView } from '@/components/market/MarketView';
import { ButtonLink } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { firstParam, parsePageParam } from '@/lib/route-params';
import { isMarketFilter } from '@/lib/status';

export const metadata: Metadata = { title: 'Pasar' };

/*
 * Filter & halaman dibaca dari URL (?filter=&page=), di server. Next.js 16:
 * searchParams adalah Promise, dan nilainya bisa array — firstParam()
 * menangani keduanya. Filter tak dikenal jatuh ke "Semua", bukan error:
 * tautan lama atau salah ketik tetap membuka halaman yang berguna.
 */
export default async function MarketPage(props: PageProps<'/market'>) {
  const sp = await props.searchParams;
  const raw = firstParam(sp.filter);
  const filter = raw && isMarketFilter(raw) ? raw : 'all';
  const page = parsePageParam(firstParam(sp.page));

  return (
    <>
      <PageHeader
        title="Pasar kontrak"
        sub="Kontrak yang bisa diambil, sedang berjalan, dan sudah selesai."
        action={<ButtonLink href="/create" icon="plus">Buat kontrak</ButtonLink>}
      />
      <MarketView filter={filter} page={page} />
    </>
  );
}
