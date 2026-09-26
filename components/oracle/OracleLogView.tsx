'use client';

import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon } from '@/components/ui/Icon';
import { Sk } from '@/components/ui/Skeleton';
import { SegLinks } from '@/components/ui/SegLinks';
import { splitByBrand } from '@/lib/brand-match';
import { formatTime } from '@/lib/format';
import { engineLabel } from '@/lib/oracle/engines';
import { type OracleRunWithBrand, useOracleLog } from '@/lib/queries';

export type LogPhase = 'all' | 'baseline' | 'verification';
const SHOWN = 150;

const PHASES: { key: LogPhase; label: string }[] = [
  { key: 'all', label: 'Semua' },
  { key: 'baseline', label: 'Baseline · T0' },
  { key: 'verification', label: 'Verifikasi · T1' },
];
const href = (p: LogPhase) => (p === 'all' ? '/oracle-log' : `/oracle-log?phase=${p}`);

/** Jawaban AI dengan brand disorot. Sorotan hanya tampilan — keputusan "disebut" milik server (run.hit). */
function Answer({ text, brand }: { text: string; brand: string | null }) {
  const parts = brand ? splitByBrand(text, brand) : [{ text, hit: false }];
  return <div className="answer">{parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}</div>;
}

function RunRow({ r, showBrand }: { r: OracleRunWithBrand; showBrand: boolean }) {
  const brand = r.jobs?.brand ?? null;
  return (
    <details>
      <summary>
        <span className={`badge ${r.hit ? 'st-mint' : 'st-rose'}`}>
          <Icon name={r.hit ? 'check' : 'x'} />{r.hit ? 'Disebut' : 'Tidak disebut'}
        </span>
        <div className="log-m">
          <div className="log-q">{r.query}</div>
          <div className="log-s">
            {showBrand && (
              <>
                <Link href={`/jobs/${r.job_id}`}>{brand ?? `Kontrak #${r.job_id}`}</Link>
                <i className="dotsep" />
              </>
            )}
            <span>{r.phase === 'baseline' ? 'Baseline · T0' : 'Verifikasi · T1'}</span>
            <i className="dotsep" />
            <span>{engineLabel(r.engine)}</span>
            <i className="dotsep" />
            <span className="num">Pertanyaan #{r.query_index + 1}</span>
          </div>
        </div>
        <span className="log-t">{formatTime(r.created_at)}<Icon name="down" /></span>
      </summary>
      <div className="log-b">
        <dl className="qa">
          <dt>Pertanyaan</dt><dd>{r.query}</dd>
          <dt>Jawaban AI</dt><dd><Answer text={r.answer} brand={brand} /></dd>
        </dl>
        <div className="meta-row">
          {r.model && <span>Model <span className="mono">{r.model}</span></span>}
          {r.latency_ms !== null && <span>Latensi <span className="num">{(r.latency_ms / 1000).toFixed(1)} dtk</span></span>}
          <span>Gaya <span className="mono">{r.engine}</span></span>
        </div>
      </div>
    </details>
  );
}

export function RunList({ runs, showBrand }: { runs: OracleRunWithBrand[]; showBrand: boolean }) {
  return <div className="card log">{runs.map((r) => <RunRow key={r.id} r={r} showBrand={showBrand} />)}</div>;
}

/**
 * Hitungan per tab sengaja TIDAK ditampilkan: GET /api/oracle-log tidak
 * mengembalikan total, dan menghitung dari daftar yang terpotong akan
 * menampilkan angka yang salah begitu log melewati batas.
 */
export function OracleLogView({ phase }: { phase: LogPhase }) {
  const q = useOracleLog({ phase: phase === 'all' ? undefined : phase, limit: SHOWN });
  const seg = <SegLinks label="Saring fase" active={phase} items={PHASES.map((p) => ({ ...p, href: href(p.key) }))} />;

  if (q.isPending) {
    return <>{seg}<div className="card" style={{ padding: 16 }} aria-busy="true">{Array.from({ length: 6 }, (_, i) => <Sk key={i} h={40} style={{ marginBottom: 12 }} />)}</div></>;
  }
  if (q.isError) return <>{seg}<ErrorState error={q.error} onRetry={() => q.refetch()} /></>;
  if (q.data.length === 0) {
    return <>{seg}<EmptyState icon="radar" title="Belum ada log Oracle">Log muncul begitu Oracle mulai mengukur baseline atau verifikasi.</EmptyState></>;
  }
  return (
    <>
      {seg}
      <RunList runs={q.data} showBrand />
      {q.data.length >= SHOWN && <p className="list-note">Menampilkan {SHOWN} panggilan terbaru.</p>}
    </>
  );
}
