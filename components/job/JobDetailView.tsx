'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { RunList } from '@/components/oracle/OracleLogView';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { MonoTile } from '@/components/ui/MonoTile';
import { Sk } from '@/components/ui/Skeleton';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ApiClientError } from '@/lib/api';
import { formatTime, shortAddr } from '@/lib/format';
import { timeline, type TimeCtx } from '@/lib/job-view';
import { useChainInfo, useJob, type JobDetail } from '@/lib/queries';
import { deriveUiStatus } from '@/lib/status';
import { RELATION_LABEL, relationToJob } from '@/lib/tx';
import { useNow } from '@/lib/use-now';
import { useWallet } from '@/components/wallet/useWallet';
import { JuryCard, LedgerCard, QueryPoolCard, TimelineCard, WorkCard } from './DetailCards';
import { RadarCard } from './RadarCard';
import { VerdictCard } from './VerdictCard';

export type DetailTab = 'overview' | 'log';

const Back = () => <Link className="back" href="/market"><Icon name="left" className="i-sm" />Pasar kontrak</Link>;

function Loading() {
  return (
    <div aria-busy="true">
      <Sk w={120} h={12} />
      <Sk w={260} h={26} style={{ marginTop: 10 }} />
      <div className="detail" style={{ marginTop: 24 }}>
        <div className="card" style={{ height: 380 }} />
        <div className="card" style={{ height: 380 }} />
      </div>
    </div>
  );
}

/**
 * /jobs/[id] — baca saja (Fase 4). Satu request memuat job + oracle_runs +
 * activity; chain-info (arbiter, alamat kontrak) di-cache terpisah.
 */
export function JobDetailView({ jobId, tab }: { jobId: number; tab: DetailTab }) {
  const q = useJob(jobId);

  if (q.isPending) return <><Back /><Loading /></>;
  if (q.isError) {
    if (q.error instanceof ApiClientError && q.error.code === 'NOT_FOUND') {
      return (
        <>
          <Back />
          <EmptyState
            icon="alert"
            title="Kontrak tidak ditemukan"
            action={<ButtonLink href="/market" variant="secondary">Buka pasar</ButtonLink>}
          >
            Tidak ada kontrak #{jobId}. Mungkin transaksinya belum tersinkron, atau nomornya salah.
          </EmptyState>
        </>
      );
    }
    return <><Back /><ErrorState error={q.error} onRetry={() => q.refetch()} /></>;
  }
  return <Detail data={q.data} tab={tab} />;
}

function Detail({ data, tab }: { data: JobDetail; tab: DetailTab }) {
  const { job, runs, activity } = data;
  const chain = useChainInfo().data;
  const now = useNow();
  const { address } = useWallet();
  const ui = deriveUiStatus(job);
  // Arbiter hanya relevan saat kontrak menunggu putusannya.
  const rel = relationToJob(job, address, chain?.arbiter);
  const relShown = rel === 'arbiter' && ui !== 'dispute' ? null : rel;

  const timeout = chain?.verifyTimeoutSeconds ? Number(chain.verifyTimeoutSeconds) : null;
  const time: TimeCtx = { now, verifyTimeoutSec: timeout !== null && Number.isFinite(timeout) ? timeout : null };
  const tl = timeline(job, ui, activity, time);

  // RunList menyorot brand lewat run.jobs.brand (bentuk endpoint global);
  // di sini brand-nya sudah diketahui. Terbaru di atas, sama seperti halaman global.
  const logRuns = useMemo(
    () => runs.map((r) => ({ ...r, jobs: { brand: job.brand } })).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [runs, job.brand]
  );

  const base = `/jobs/${job.job_id}`;

  return (
    <>
      <Back />
      <div className="dhead">
        <div className="dhead-l">
          <MonoTile brand={job.brand} size={56} />
          <div>
            <div className="eyebrow">
              <span className="num">Kontrak #{job.job_id}</span>
              <i className="dotsep" />
              <span>dibuat {formatTime(job.created_at)}</span>
              <i className="dotsep" />
              <span>client <span className="mono">{shortAddr(job.client_addr)}</span></span>
              {job.multi_engine && <><i className="dotsep" /><span>2 gaya penjawab</span></>}
            </div>
            <h1>{job.brand}</h1>
            {job.brief && <p className="page-sub">{job.brief}</p>}
          </div>
        </div>
        <div className="dhead-r">
          {relShown && <span className="tag tag-chain tag-lg">Anda: {RELATION_LABEL[relShown]}</span>}
          <StatusBadge status={ui} size="lg" />
        </div>
      </div>

      <nav className="tabs" aria-label="Bagian kontrak">
        <Link href={base} scroll={false} aria-current={tab === 'overview' ? 'page' : undefined}>Ringkasan</Link>
        <Link href={`${base}?tab=log`} scroll={false} aria-current={tab === 'log' ? 'page' : undefined}>
          Log Oracle <span className="cnt num">{runs.length}</span>
        </Link>
      </nav>

      {tab === 'log' ? (
        logRuns.length > 0
          ? <RunList runs={logRuns} showBrand={false} />
          : <EmptyState icon="radar" title="Belum ada panggilan AI">Log muncul begitu Oracle mulai mengukur baseline.</EmptyState>
      ) : (
        <div className="detail">
          <div className="stack">
            <TimelineCard steps={tl.steps} reached={tl.reached} />
            <QueryPoolCard job={job} runs={runs} />
            <WorkCard job={job} ui={ui} runs={runs} activity={activity} time={time} rel={rel} chain={chain} />
            {ui === 'dispute' && <JuryCard job={job} arbiter={chain?.arbiter ?? null} rel={rel} />}
          </div>
          <div className="stack detail-r">
            <LedgerCard job={job} ui={ui} activity={activity} chain={chain} />
            <RadarCard job={job} runs={runs} />
            <VerdictCard job={job} runs={runs} />
          </div>
        </div>
      )}
    </>
  );
}
