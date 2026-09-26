'use client';

import { useState } from 'react';
import { Icon } from '@/components/ui/Icon';
import { phaseHits, TARGET_BASELINE_WARNING, targetNotAboveBaseline, type Phase } from '@/lib/job-view';
import type { Job, OracleRun } from '@/lib/types';
import { hitsProblem } from './DetailCards';

interface Node { label: string; hit: boolean | null; title: string }

/** Satu titik per pertanyaan. Geometri & kelas dari mockup (radarSvg). */
function RadarSvg({ items }: { items: Node[] }) {
  const S = 260, c = S / 2, R = S * 0.37, n = Math.max(items.length, 1);
  return (
    <svg className="radar" viewBox={`0 0 ${S} ${S}`} role="img" aria-label="Radar sitasi brand per pertanyaan">
      <circle cx={c} cy={c} r={R} className="rd-ring" />
      <circle cx={c} cy={c} r={(R * 0.58).toFixed(1)} className="rd-ring rd-ring-2" />
      {items.map((it, i) => {
        const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
        const st = it.hit === null ? 'p' : it.hit ? 'y' : 'n';
        return (
          <line key={`s${i}`} className={`rd-sp rd-${st}`}
            x1={(c + 27 * Math.cos(a)).toFixed(1)} y1={(c + 27 * Math.sin(a)).toFixed(1)}
            x2={(c + R * Math.cos(a)).toFixed(1)} y2={(c + R * Math.sin(a)).toFixed(1)} />
        );
      })}
      <circle cx={c} cy={c} r={23} className="rd-core" />
      <text x={c} y={c + 2.8} textAnchor="middle" className="rd-core-t">BRAND</text>
      {items.map((it, i) => {
        const a = ((-90 + (i * 360) / n) * Math.PI) / 180;
        const x = c + R * Math.cos(a), y = c + R * Math.sin(a);
        const st = it.hit === null ? 'p' : it.hit ? 'y' : 'n';
        return (
          <g key={`n${i}`} className={`rd-nd rd-${st}`}>
            <title>{`${it.title} — ${it.hit === null ? 'menunggu' : it.hit ? 'menyebut brand' : 'tidak menyebut'}`}</title>
            <circle cx={x.toFixed(1)} cy={y.toFixed(1)} r={15} />
            <text x={x.toFixed(1)} y={(y + 3.5).toFixed(1)} textAnchor="middle">{it.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');

/**
 * Radar sitasi. Titik-titiknya dari log oracle_runs lewat phaseHits() —
 * aturan gabung yang SAMA dengan skor verdict (§A11). Skor di bawahnya
 * dari kolom job (ditulis server), jadi kalau keduanya berbeda, audit
 * verdict yang akan menunjukkannya.
 */
export function RadarCard({ job, runs }: { job: Job; runs: OracleRun[] }) {
  const sub = job.verification_subset;
  const [chosen, setChosen] = useState<Phase | null>(null);
  const phase: Phase = sub ? (chosen ?? 'verification') : 'baseline';

  const ph = phaseHits(job, runs, phase);
  const n = job.queries.length;
  const indices = phase === 'verification' && sub ? sub : job.queries.map((_, i) => i);
  const items: Node[] = indices.map((qi) => ({ label: `#${qi + 1}`, hit: ph.hits.get(qi) ?? null, title: job.queries[qi] ?? '' }));
  const problem = hitsProblem(ph);

  const bs = job.baseline_score, vs = job.verification_score, vo = job.verification_of;
  const delta = vs !== null && vo && bs !== null && n ? vs / vo - bs / n : null;

  return (
    <section className="card">
      <div className="card-h">
        <h3>Radar sitasi AI</h3>
        {sub && (
          <div className="seg seg-sm" role="group" aria-label="Fase radar">
            {(['baseline', 'verification'] as const).map((p) => (
              <button key={p} type="button" aria-pressed={phase === p} onClick={() => setChosen(p)}>
                {p === 'baseline' ? 'Baseline' : 'Verifikasi'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="radar-wrap">
        <RadarSvg items={items} />
        <div className="legend" style={{ justifyContent: 'center', marginTop: 6 }}>
          <span><i className="lg lg-y" />Menyebut</span>
          <span><i className="lg lg-n" />Tidak</span>
          <span><i className="lg lg-p" />Menunggu</span>
        </div>
        {problem && <p className="radar-note">{problem}</p>}
      </div>
      <div className="score">
        <div><b>{bs !== null ? `${bs}/${n}` : '—'}</b><span>Baseline · {bs !== null ? pct(bs, n) : 'belum'}</span></div>
        <div>
          <b className={delta === null ? undefined : delta > 0 ? 'up' : 'dn'}>{vs !== null && vo ? `${vs}/${vo}` : '—'}</b>
          <span>Verifikasi · {vs !== null && vo ? pct(vs, vo) : 'belum'}</span>
        </div>
        <div><b>{pct(job.target_count, n)}</b><span>Target · {job.target_count}/{n}</span></div>
      </div>
      {/* Hanya selama kontrak berjalan — setelah selesai (terutama ditarik kembali) kalimatnya menyesatkan. */}
      {targetNotAboveBaseline(job) && job.status !== 'ReleasedFull' && job.status !== 'Refunded' && (
        <div className="card-b" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="note note-warn"><Icon name="alert" /><div>{TARGET_BASELINE_WARNING}</div></div>
        </div>
      )}
    </section>
  );
}
