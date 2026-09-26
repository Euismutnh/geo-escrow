'use client';

import { useState } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { JobGridSkeleton } from '@/components/ui/Skeleton';
import { useWallet } from '@/components/wallet/useWallet';
import { useWalletUi } from '@/components/wallet/WalletUi';
import { LIMITS, useChainInfo, useJobs } from '@/lib/queries';
import { relationToJob, sameAddr } from '@/lib/tx';
import { JobGrid } from './JobCard';

type As = 'all' | 'client' | 'freelancer';
const TABS: { key: As; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'client', label: 'Sebagai client' },
  { key: 'freelancer', label: 'Sebagai freelancer' },
];

/**
 * Kontrak yang melibatkan wallet AKTIF. Kunci query memuat alamat, jadi
 * ganti akun di ekstensi = daftar lain, tanpa cache lama (verifikasi #3).
 * Peran per kontrak dihitung di klien dari alamat yang sama.
 */
function Mine({ address }: { address: string }) {
  const q = useJobs({ wallet: address, limit: LIMITS.jobs });
  const arbiter = useChainInfo().data?.arbiter ?? null;
  const [as, setAs] = useState<As>('all');

  if (q.isPending) return <JobGridSkeleton count={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const all = q.data.jobs;
  const count = (k: As) => (k === 'all' ? all.length : all.filter((j) => relationToJob(j, address) === k).length);
  const list = as === 'all' ? all : all.filter((j) => relationToJob(j, address) === as);

  if (all.length === 0) {
    if (sameAddr(arbiter, address)) {
      return (
        <EmptyState icon="scale" title="Wallet ini adalah arbiter" action={<ButtonLink href="/market?filter=dispute" variant="secondary" icon="scale">Lihat yang perlu juri</ButtonLink>}>
          Arbiter tidak menjadi client atau freelancer. Kontrak yang menunggu putusan Anda ada di Pasar → Perlu juri.
        </EmptyState>
      );
    }
    return (
      <EmptyState icon="folder" title="Belum ada kontrak" action={<ButtonLink href="/create" icon="plus">Buat kontrak</ButtonLink>}>
        Kontrak yang Anda buat atau ambil dengan wallet ini akan muncul di sini.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="seg-wrap">
        <div className="seg" role="group" aria-label="Saring peran">
          {TABS.map((t) => (
            <button key={t.key} type="button" aria-pressed={as === t.key} onClick={() => setAs(t.key)}>
              {t.label}<span className="cnt">{count(t.key)}</span>
            </button>
          ))}
        </div>
      </div>
      {list.length > 0
        ? <JobGrid jobs={list} />
        : <EmptyState icon="folder" title={`Belum ada kontrak ${as === 'client' ? 'yang Anda danai' : 'yang Anda kerjakan'}`} />}
      {q.data.total > all.length && <p className="list-note">Menampilkan {all.length} dari {q.data.total} kontrak terbaru.</p>}
    </>
  );
}

export function MyJobsView() {
  const w = useWallet();
  const { openConnect } = useWalletUi();

  if (w.restoring) return <JobGridSkeleton count={3} />;
  if (!w.address) {
    return (
      <EmptyState
        icon="wallet"
        title="Wallet belum terhubung"
        action={<button type="button" className="btn btn-primary" onClick={openConnect}><Icon name="wallet" />Hubungkan wallet</button>}
      >
        Hubungkan wallet untuk melihat kontrak yang Anda danai atau kerjakan.
      </EmptyState>
    );
  }
  // key: ganti akun → state tab & query mulai dari nol untuk alamat baru.
  return <Mine key={w.address.toLowerCase()} address={w.address} />;
}
