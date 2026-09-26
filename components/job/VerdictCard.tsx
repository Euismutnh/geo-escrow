'use client';

import { useMemo } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { shortHash } from '@/lib/explorer';
import { auditVerdict, decisionMath, type CheckResult } from '@/lib/job-view';
import { useReadContract, useTransaction, useTransactionReceipt } from 'wagmi';
import { geoEscrowAbi } from '@/lib/abi';
import { useChainInfo, useVerdict } from '@/lib/queries';
import type { Job, OracleRun } from '@/lib/types';
import { canonicalVerdict, verdictHash } from '@/lib/verdict';
import { CHAIN } from '@/lib/wagmi';

const CK_ICON: Record<CheckResult, IconName> = { y: 'check', n: 'x', s: 'dot' };
const BADGE: Record<CheckResult, [cls: string, icon: IconName, label: string]> = {
  y: ['st-mint', 'check', 'Semua lolos'],
  n: ['st-rose', 'x', 'Ada yang tidak cocok'],
  s: ['st-warn', 'dot', 'Lolos · sebagian dilewati'],
};

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

/**
 * Audit verdict — layar yang membuktikan klaim "hasilnya diukur, bukan
 * diklaim" (§A12).
 *
 * Kedelapan pemeriksaannya DIULANG DI BROWSER dari data publik (lib/job-view.ts
 * auditVerdict): subset dari seed, hit dari log AI, keputusan dari skor,
 * hash dari verdict, dan — sejak Fase 8 (S-12) — keterikatan verdict ke
 * kontrak: seed, parameter, hash pertanyaan & konten. Data on-chain dibaca browser
 * LANGSUNG dari kontrak (getJob lewat RPC publik), bukan ditanyakan ke
 * server. Server tetap dimintai kesimpulannya sendiri, hanya untuk
 * dibandingkan: kalau berbeda, itu sendiri temuan audit.
 */
export function VerdictCard({ job, runs }: { job: Job; runs: OracleRun[] }) {
  const verdict = job.verdict_json;
  const { data } = useVerdict(job.job_id, verdict !== null);
  const info = useChainInfo();
  const contract = info.data?.contractAddress as `0x${string}` | null | undefined;
  const chainEnabled = !!info.data?.chainEnabled;
  const onChain = useReadContract({
    address: contract ?? undefined,
    abi: geoEscrowAbi,
    functionName: 'getJob',
    args: [BigInt(job.job_id)],
    chainId: CHAIN.id,
    // Chain mati = job di database belum tentu job yang sama di kontrak
    // (seed memakai jobId rendah) — membandingkannya menyesatkan.
    query: { enabled: verdict !== null && !!contract && chainEnabled },
  });
  const onChainHash = onChain.data?.verdictHash;
  const onChainSeed = onChain.data?.verificationSeed;
  const onChainPool = onChain.data?.queryPoolHash;
  const onChainDeliv = onChain.data?.deliverableHash;

  // GEOv2: transaksi konfirmasi yang bloknya dipakai mengundi — dibaca
  // browser langsung dari RPC publik, bukan dari server.
  const confirmHash = verdict?.v === 'GEOv2' && /^0x[0-9a-fA-F]{64}$/.test(verdict.confirmTx) ? verdict.confirmTx as `0x${string}` : undefined;
  const ctx = useTransaction({ hash: confirmHash, chainId: CHAIN.id, query: { enabled: !!confirmHash && chainEnabled, retry: 1 } });
  const crc = useTransactionReceipt({ hash: confirmHash, chainId: CHAIN.id, query: { enabled: !!confirmHash && chainEnabled, retry: 1 } });
  const confirmTx = useMemo(() => (!confirmHash ? undefined
    : ctx.isPending || crc.isPending ? 'loading' as const
    : ctx.data ? { to: ctx.data.to ?? null, input: ctx.data.input, blockHash: ctx.data.blockHash ?? null, status: crc.data?.status ?? null }
    : null), [confirmHash, ctx.isPending, crc.isPending, ctx.data, crc.data?.status]);

  const audit = useMemo(() => {
    if (!verdict) return null;
    const chain = info.isPending ? 'loading' as const
      : info.isError ? 'error' as const
      : !chainEnabled || !contract ? { onChain: null, chainEnabled: false }
      : onChain.isPending ? 'loading' as const
      : onChain.isError ? 'error' as const
      : { onChain: onChainHash ?? null, chainEnabled: true, seed: onChainSeed ?? null, queryPoolHash: onChainPool ?? null, deliverableHash: onChainDeliv ?? null, contract: contract ?? null, confirmTx };
    return auditVerdict(job, verdict, runs, chain);
  }, [job, verdict, runs, info.isPending, info.isError, chainEnabled, contract, onChain.isPending, onChain.isError, onChainHash, onChainSeed, onChainPool, onChainDeliv, confirmTx]);

  if (!verdict || !audit) {
    // Seed/dev bisa punya keputusan tanpa objek verdict. Produksi selalu
    // menyimpan keduanya bersamaan — tapi jangan diam saja kalau tidak.
    if (!job.verification_decision) return null;
    return (
      <section className="card">
        <div className="card-h"><h3>Audit verdict</h3></div>
        <div className="card-b">
          <div className="note note-plain">
            <Icon name="info" />
            <div>Objek verdict lengkap tidak tersimpan untuk kontrak ini, jadi hitungan ulangnya tidak bisa ditampilkan.</div>
          </div>
        </div>
      </section>
    );
  }

  const [cls, icon, label] = BADGE[audit.overall];
  const m = decisionMath(verdict);
  const why = {
    release: `${m.lhs} ≥ ${m.rhs} → cair ke freelancer`,
    refund: `${m.lhs} ≤ ${m.floor} → refund ke client`,
    dispute: `${m.floor} < ${m.lhs} < ${m.rhs} → zona abu, ke arbiter`,
  }[verdict.decision];
  const canonical = safe(() => canonicalVerdict(verdict));
  const recomputed = safe(() => verdictHash(verdict));
  const server = data?.audit.allChecksPassed;
  // Browser dan server menghitung hal yang sama; kalau kesimpulannya
  // berbeda, itu sendiri temuan audit.
  const disagree = server !== undefined && (server ? audit.overall === 'n' : audit.overall !== 'n');

  return (
    <section className="card">
      <div className="card-h">
        <h3>Audit verdict</h3>
        <span className={`badge ${cls}`}><Icon name={icon} />{label}</span>
      </div>
      <ul className="audit">
        {audit.checks.map((c) => (
          <li key={c.key}>
            <span className={`ck ${c.result}`}><Icon name={CK_ICON[c.result]} /></span>
            <div>{c.title}<small>{c.detail}</small></div>
          </li>
        ))}
      </ul>
      <div className="card-b" style={{ borderTop: '1px solid var(--line)' }}>
        <table className="frm">
          <tbody>
            <tr><td>Skor × jumlah pertanyaan</td><td>{verdict.score} × {verdict.n} = {m.lhs}</td></tr>
            <tr><td>Target × ukuran subset</td><td>{verdict.target} × {verdict.of} = {m.rhs}</td></tr>
            <tr><td>Batas refund (− 2 × {verdict.n})</td><td>{m.rhs} − {2 * verdict.n} = {m.floor}</td></tr>
            <tr className="res"><td>Keputusan</td><td>{why}</td></tr>
          </tbody>
        </table>
        <details className="canon">
          <summary><Icon name="hash" className="i-sm" />String kanonik (hitung keccak256 sendiri)</summary>
          {canonical !== null && <pre>{canonical}</pre>}
          <dl>
            <dt>Browser</dt><dd>{recomputed ?? '—'}</dd>
            <dt>Database</dt><dd>{job.verdict_hash ?? '—'}</dd>
            <dt>On-chain</dt><dd>{!chainEnabled ? '— (blockchain nonaktif)' : onChain.isPending ? '…' : (onChainHash ?? '—')}</dd>
          </dl>
        </details>
      </div>
      <div className="card-f">
        <span>
          {server === undefined ? 'Pemeriksaan server: memuat…' : `Pemeriksaan server: ${server ? 'semua lolos' : 'ada yang gagal'}`}
          {disagree && <b style={{ color: 'var(--danger)' }}> — berbeda dengan hitungan browser</b>}
        </span>
        <a className="lnk" href={`/api/jobs/${job.job_id}/verdict`} target="_blank" rel="noopener noreferrer" title={job.verdict_hash ?? undefined}>
          JSON verdict {job.verdict_hash && <span className="mono">{shortHash(job.verdict_hash)}</span>}
        </a>
      </div>
    </section>
  );
}
