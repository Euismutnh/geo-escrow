'use client';

import Link from 'next/link';
import { Money } from '@/components/ui/Money';
import { MonoTile } from '@/components/ui/MonoTile';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { formatRelative } from '@/lib/format';
import { deriveUiStatus } from '@/lib/status';
import type { Job } from '@/lib/types';
import { useWallet } from '@/components/wallet/useWallet';
import { relationToJob } from '@/lib/tx';
import { useNow } from '@/lib/use-now';

/**
 * Meter sitasi: isian = skor terakhir yang diketahui (verifikasi kalau ada,
 * kalau belum baseline), garis hitam = target.
 *
 * Warna isian mengikuti KEPUTUSAN verdict, bukan perbandingan kasar dengan
 * target: skor zona abu diwarnai kuning, bukan merah (pelajaran Fase 1 —
 * job "Juri: dana cair" dengan meter merah menyesatkan).
 */
function Meter({ job }: { job: Job }) {
  const n = job.queries.length;
  const target = n > 0 ? (job.target_count / n) * 100 : 0;
  const hasV = job.verification_score !== null && job.verification_of !== null && job.verification_of > 0;
  const ratio = hasV
    ? job.verification_score! / job.verification_of!
    : job.baseline_score !== null && n > 0 ? job.baseline_score / n : null;
  const tone = hasV ? ({ release: 'ok', refund: 'lo', dispute: 'mid' } as const)[job.verification_decision ?? 'dispute'] : '';
  const label = hasV
    ? `Verifikasi ${job.verification_score}/${job.verification_of}`
    : job.baseline_score !== null ? `Baseline ${job.baseline_score}/${n}` : 'Baseline belum terukur';

  return (
    <div title={`Garis hitam = target ${job.target_count} dari ${n} pertanyaan`}>
      <div className="meter-bar">
        <span className={`meter-fill ${tone}`} style={{ width: `${ratio ? Math.max(ratio * 100, 3) : 0}%` }} />
        <span className="meter-tgt" style={{ left: `${target}%` }} />
      </div>
      <div className="meter-l"><span>{label}</span><span>Target {job.target_count}/{n}</span></div>
    </div>
  );
}

/**
 * Kartu kontrak. Seluruh kartu bisa diklik (tautan "stretched" di judul),
 * jadi tidak ada elemen interaktif bersarang di dalam <a>.
 *
 * `role` diisi dari relasi wallet aktif (Fase 5). Tombol "Ambil kontrak"
 * menyusul di Fase 7 — butuh wallet dan requiredBond().
 */
export function JobCard({ job, role }: { job: Job; role?: 'client' | 'freelancer' | null }) {
  const ui = deriveUiStatus(job);
  const now = useNow(); // null di server & saat hydration -> tenggat tidak ditampilkan dulu
  const deadline = job.status === 'Open' && job.accept_deadline ? Date.parse(job.accept_deadline) : NaN;
  return (
    <article className="card job">
      <div className="job-top">
        <div className="job-who">
          <MonoTile brand={job.brand} size={40} />
          <div>
            <div className="job-id">#{job.job_id}</div>
            <h3 className="job-brand"><Link href={`/jobs/${job.job_id}`}>{job.brand}</Link></h3>
          </div>
        </div>
        <StatusBadge status={ui} />
      </div>
      <p className="job-brief">{job.brief || 'Tanpa brief.'}</p>
      <Meter job={job} />
      <div className="job-foot">
        <div className="job-meta">
          <span className="amt"><Money wei={job.budget_wei} /></span>
          {!Number.isNaN(deadline) && now !== null && (
            <span>· {deadline < now ? 'batas ambil lewat' : `tutup ${formatRelative(deadline, now)}`}</span>
          )}
          {role && <span className="tag">Anda: {role === 'client' ? 'Client' : 'Freelancer'}</span>}
        </div>
      </div>
    </article>
  );
}

/**
 * Label "Anda: …" dihitung dari wallet AKTIF di setiap render — ganti akun
 * di ekstensi, labelnya ikut berganti tanpa cache (verifikasi Fase 5 #3).
 * Arbiter tidak diberi label per kartu: itu peran tingkat-kontrak.
 */
export function JobGrid({ jobs }: { jobs: Job[] }) {
  const { address } = useWallet();
  return (
    <div className="jobs">
      {jobs.map((j) => {
        const r = relationToJob(j, address);
        return <JobCard key={j.job_id} job={j} role={r === 'client' || r === 'freelancer' ? r : null} />;
      })}
    </div>
  );
}
