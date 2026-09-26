'use client';

import { useQueries } from '@tanstack/react-query';
import { JobGrid } from '@/components/jobs/JobCard';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { JobGridSkeleton } from '@/components/ui/Skeleton';
import { SegLinks } from '@/components/ui/SegLinks';
import { jobsQuery, useJobs } from '@/lib/queries';
import type { MarketFilter } from '@/lib/status';

const PAGE_SIZE = 24; // di bawah batas server (50)

const TABS: { key: MarketFilter; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'open', label: 'Terbuka' },
  { key: 'progress', label: 'Berjalan' },
  { key: 'dispute', label: 'Perlu juri' },
  { key: 'done', label: 'Selesai' },
];

export function marketHref(filter: MarketFilter, page = 1): string {
  const p = new URLSearchParams();
  if (filter !== 'all') p.set('filter', filter);
  if (page > 1) p.set('page', String(page));
  const s = p.toString();
  return s ? `/market?${s}` : '/market';
}

/**
 * Hitungan per tab diambil dari `total` milik server (limit=1 per tab),
 * BUKAN dihitung dari daftar yang dimuat — daftar itu terpotong per halaman,
 * dan tab "Berjalan" adalah gabungan tiga status yang dipetakan server
 * (MARKET_FILTERS di lib/status.ts).
 */
export function MarketView({ filter, page }: { filter: MarketFilter; page: number }) {
  const counts = useQueries({
    queries: TABS.map((t) => jobsQuery({ filter: t.key, limit: 1 })),
  });
  // Halaman di luar jangkauan aman diminta: GET /api/jobs membalas daftar
  // kosong + total yang benar (diperbaiki 2026-09-24; dulu 500).
  const list = useJobs({ filter, page, limit: PAGE_SIZE });

  const seg = (
    <SegLinks
      label="Saring kontrak"
      active={filter}
      items={TABS.map((t, i) => ({ key: t.key, label: t.label, href: marketHref(t.key), count: counts[i].data?.total }))}
    />
  );

  if (list.isPending) return <>{seg}<JobGridSkeleton count={6} /></>;
  if (list.isError) return <>{seg}<ErrorState error={list.error} onRetry={() => list.refetch()} /></>;

  const { jobs, total } = list.data;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (jobs.length === 0) {
    const beyond = total > 0 && page > pages; // mis. ?page=99 dari tautan lama
    return (
      <>
        {seg}
        <EmptyState
          icon="store"
          title={beyond ? 'Halaman ini kosong' : 'Belum ada kontrak di filter ini'}
          action={beyond
            ? <ButtonLink href={marketHref(filter)} variant="secondary">Ke halaman pertama</ButtonLink>
            : filter === 'all' ? <ButtonLink href="/create" icon="plus">Buat kontrak</ButtonLink> : undefined}
        >
          {beyond ? `Filter ini hanya punya ${pages} halaman.` : 'Coba filter lain, atau buat kontrak baru.'}
        </EmptyState>
      </>
    );
  }

  const from = (page - 1) * PAGE_SIZE + 1, to = from + jobs.length - 1;
  return (
    <>
      {seg}
      <JobGrid jobs={jobs} />
      {pages > 1 && (
        <div className="pager">
          <span className="num">{from}–{to} dari {total} kontrak</span>
          <div className="pager-b">
            {page > 1 && <ButtonLink href={marketHref(filter, page - 1)} variant="secondary" size="sm" icon="left">Sebelumnya</ButtonLink>}
            {page < pages && <ButtonLink href={marketHref(filter, page + 1)} variant="secondary" size="sm">Berikutnya</ButtonLink>}
          </div>
        </div>
      )}
    </>
  );
}
