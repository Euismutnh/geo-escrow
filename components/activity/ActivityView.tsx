'use client';

import Link from 'next/link';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { Sk } from '@/components/ui/Skeleton';
import { txUrl } from '@/lib/explorer';
import { formatRelative, formatTime, shortAddr } from '@/lib/format';
import { useActivity, useChainInfo, useJobs } from '@/lib/queries';
import type { ActivityEntry } from '@/lib/types';
import { useNow } from '@/lib/use-now';

const SHOWN = 150;

/** Label & nada per tipe. Tipe yang belum dikenal tetap tampil — dengan nama mentahnya. */
const META: Record<string, [label: string, icon: IconName, tone: string]> = {
  deposit: ['Kunci dana', 'in', 'ty-in'],
  bond_lock: ['Kunci bond', 'in', 'ty-in'],
  structural_release: ['Cair struktural', 'out', 'ty-out'],
  structural_rejected: ['Struktural ditolak', 'x', 'ty-x'],
  dispute_raised: ['Dispute dibuka', 'scale', 'ty-back'],
  vrf_pick: ['Undian subset', 'dot', ''],
  final_release: ['Cair akhir', 'out', 'ty-out'],
  final_refund: ['Refund akhir', 'undo', 'ty-back'],
  jury_release: ['Juri: cair', 'out', 'ty-out'],
  jury_refund: ['Juri: refund', 'undo', 'ty-back'],
  // Rincian dari transfer "Cair akhir"/"Refund akhir" di atasnya — bukan transfer kedua (lib/ledger.ts).
  bond_return: ['Rincian: bond kembali', 'dot', ''],
  bond_slash: ['Rincian: bond di-slash', 'dot', 'ty-x'],
  reclaim: ['Tarik kembali', 'undo', 'ty-back'],
};

/**
 * Nama peran untuk alamat yang dikenal. Semua perbandingan tanpa membedakan
 * huruf: database menyimpan alamat huruf kecil, kontrak & wallet memberi
 * checksum (huruf campuran). `===` biasa akan selalu gagal.
 */
function useKnownAddrs(): Map<string, string> {
  const c = useChainInfo().data;
  const known = new Map<string, string>();
  if (c?.contractAddress) known.set(c.contractAddress.toLowerCase(), 'Kontrak');
  if (c?.oracle) known.set(c.oracle.toLowerCase(), 'Oracle');
  if (c?.arbiter) known.set(c.arbiter.toLowerCase(), 'Arbiter');
  return known;
}

function Addr({ a, known }: { a: string | null; known: Map<string, string> }) {
  if (!a) return <span className="faint">—</span>;
  const k = known.get(a.toLowerCase());
  return k ? <span className="k">{k}</span> : <span className="mono">{shortAddr(a)}</span>;
}

function Row({ a, brand, known, now }: { a: ActivityEntry; brand?: string; known: Map<string, string>; now: number | null }) {
  const [text, icon, tone] = META[a.type] ?? [a.type, 'dot', ''];
  return (
    <tr>
      <td><span className={`ty ${tone}`}><span className="ty-ic"><Icon name={icon} /></span>{text}</span></td>
      <td className="t-r"><span className="amt">{a.amount_wei !== null ? <Money wei={a.amount_wei} /> : <span className="faint">—</span>}</span></td>
      <td className="c-flow"><span className="flow"><Addr a={a.from_addr} known={known} /><Icon name="arrow" /><Addr a={a.to_addr} known={known} /></span></td>
      <td className="c-note">
        {a.job_id !== null
          ? <><Link className="job-l" href={`/jobs/${a.job_id}`}>{brand ?? `Kontrak #${a.job_id}`}</Link>{brand && <span className="faint num"> #{a.job_id}</span>}</>
          : <span className="faint">—</span>}
        {a.note && <div className="faint" style={{ fontSize: 12, whiteSpace: 'normal', maxWidth: '34ch' }}>{a.note}</div>}
      </td>
      <td>
        <a className="txl mono" href={txUrl(a.tx_hash)} target="_blank" rel="noopener noreferrer" title={a.tx_hash}>
          {a.tx_hash.slice(0, 8)}…{a.tx_hash.slice(-6)}<Icon name="ext" />
        </a>
      </td>
      <td className="t-r faint" style={{ fontSize: 12.5 }} title={formatTime(a.created_at)}>{now === null ? '' : formatRelative(a.created_at, now)}</td>
    </tr>
  );
}

export function ActivityView() {
  const q = useActivity({ limit: SHOWN });
  const known = useKnownAddrs();
  const now = useNow();
  // Nama brand hanya pelengkap: aktivitas cuma membawa job_id. Kontrak di
  // luar 50 terbaru tetap tampil sebagai "Kontrak #id".
  const jobs = useJobs({ limit: 50 });
  const brands = new Map(jobs.data?.jobs.map((j) => [j.job_id, j.brand]) ?? []);

  if (q.isPending) {
    return <div className="card" style={{ padding: 16 }} aria-busy="true">{Array.from({ length: 8 }, (_, i) => <Sk key={i} h={34} style={{ marginBottom: 12 }} />)}</div>;
  }
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data.length === 0) {
    return <EmptyState icon="ledger" title="Belum ada aktivitas">Transaksi escrow tercatat di sini begitu ada kontrak yang dibuat.</EmptyState>;
  }
  return (
    <>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr><th>Jenis</th><th className="t-r">Jumlah</th><th>Aliran</th><th>Kontrak</th><th>Transaksi</th><th className="t-r">Waktu</th></tr>
          </thead>
          <tbody>
            {q.data.map((a) => <Row key={a.id} a={a} brand={a.job_id !== null ? brands.get(a.job_id) : undefined} known={known} now={now} />)}
          </tbody>
        </table>
      </div>
      {q.data.length >= SHOWN && <p className="list-note">Menampilkan {SHOWN} aktivitas terbaru.</p>}
    </>
  );
}
