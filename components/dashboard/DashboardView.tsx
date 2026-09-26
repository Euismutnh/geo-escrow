'use client';

import Link from 'next/link';
import { useState, type ReactNode } from 'react';
import { ArbiterAdmin } from '@/components/admin/ArbiterAdmin';
import { JobGrid } from '@/components/jobs/JobCard';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { Icon, type IconName } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { JobGridSkeleton, Sk } from '@/components/ui/Skeleton';
import { WalletBalance } from '@/components/wallet/AccountButton';
import { useTbnbBalance, useWallet } from '@/components/wallet/useWallet';
import { useWalletUi } from '@/components/wallet/WalletUi';
import { addrUrl } from '@/lib/explorer';
import { formatTBNB, shortAddr } from '@/lib/format';
import { ledgerBalance, ledgerSeries, lockedFor, receivedBy } from '@/lib/ledger';
import { LIMITS, useActivity, useChainInfo, useJobs, useStats } from '@/lib/queries';
import { POLL_SLOW_MS } from '@/lib/status';
import { useNow } from '@/lib/use-now';

const DAY = 86_400_000;

/** Grafik tren. Number() di sini HANYA untuk menggambar — angka yang ditampilkan tetap BigInt. */
function Spark({ values }: { values: bigint[] }) {
  const W = 300, H = 46;
  const nums = values.map((v) => Number(v) / 1e18);
  const max = Math.max(...nums), min = Math.min(...nums), r = max - min || 1;
  const pts = nums.map((v, i) => [(i / (nums.length - 1)) * W, H - 4 - ((v - min) / r) * (H - 10)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  return (
    <svg className="spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Tren dana terkunci 21 hari terakhir">
      <defs>
        <linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".26" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#spark-fill)" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Tren 21 hari dari ledger aktivitas — HANYA kalau ledger itu cocok sampai
 * ke wei dengan saldo kontrak sungguhan. Tren dari ledger yang tidak cocok
 * (data seed, indexer tertinggal) menggambar sejarah yang tidak pernah
 * terjadi; lebih jujur menyebut selisihnya.
 */
function LedgerTrend({ onChain, chainEnabled }: { onChain: bigint; chainEnabled: boolean }) {
  const act = useActivity({ limit: LIMITS.activity });
  const now = useNow();
  if (act.isPending || now === null) return <Sk h={46} style={{ marginTop: 14 }} />;
  if (act.isError) return <div className="trend">Riwayat aktivitas tidak termuat — tren tidak ditampilkan.</div>;

  const rows = act.data;
  if (rows.length >= LIMITS.activity) return <div className="trend">Riwayat melebihi {LIMITS.activity} aktivitas — tren tidak bisa dihitung di browser.</div>;
  const { balance, problems } = ledgerBalance(rows);
  if (problems.length) return <div className="trend">Ada aktivitas yang tidak dikenali — tren tidak ditampilkan.</div>;
  if (balance !== onChain) {
    return (
      <div className="trend" title={`Ledger aktivitas: ${formatTBNB(balance)}`}>
        {chainEnabled
          ? `Ledger aktivitas mencatat ${formatTBNB(balance)} — indexer belum menyusul saldo kontrak.`
          : `Mode pengembangan: ledger aktivitas (${formatTBNB(balance)}) berasal dari data seed, bukan dari kontrak.`}
      </div>
    );
  }
  const series = ledgerSeries(rows, now - 21 * DAY, now, 30);
  const d7 = balance - ledgerBalance(rows, now - 7 * DAY).balance;
  const sign = d7 > 0n ? '+' : d7 < 0n ? '−' : '±';
  return (
    <>
      <Spark values={series} />
      <div className="trend"><span className="trend-v">{sign}{formatTBNB(d7 < 0n ? -d7 : d7)}</span><span>7 hari terakhir</span></div>
    </>
  );
}

/**
 * "Total di escrow · semua kontrak" = saldo tBNB kontrak escrow, dibaca LANGSUNG dari
 * blockchain (§A5). Itulah kebenarannya; ledger aktivitas hanya cermin
 * yang ditulis indexer, dan dipakai untuk tren saja (lihat LedgerTrend).
 */
function LockedHero() {
  const chain = useChainInfo();
  const contract = chain.data?.contractAddress ?? null;
  // Saldo escrow berubah oleh transaksi SIAPA PUN — bukan hanya wallet ini (Fase 9).
  const bal = useTbnbBalance(contract, POLL_SLOW_MS);

  let body: ReactNode;
  if (chain.isPending || (contract && bal.isPending)) {
    body = <><Sk w="45%" h={30} style={{ marginTop: 18 }} /><Sk h={46} style={{ marginTop: 14 }} /></>;
  } else if (!contract) {
    body = <><div className="bal-n num">—</div><div className="trend">Alamat kontrak belum dikonfigurasi di server.</div></>;
  } else if (bal.isError) {
    body = (
      <>
        <div className="bal-n num">—</div>
        <p className="trend">Saldo kontrak tidak terbaca dari RPC. <button type="button" className="trend-v" onClick={() => bal.refetch()}>Coba lagi</button></p>
      </>
    );
  } else {
    body = (
      <>
        <div className="bal-n"><Money wei={bal.data!.value} /></div>
        <LedgerTrend onChain={bal.data!.value} chainEnabled={!!chain.data?.chainEnabled} />
      </>
    );
  }

  return (
    <div className="card bal hero">
      <div className="bal-top">
        <span className="bal-l"><Icon name="lock" />Total di escrow · semua kontrak</span>
        {contract && (
          <a className="bal-addr mono" href={addrUrl(contract)} target="_blank" rel="noopener noreferrer">
            {shortAddr(contract)}<Icon name="ext" />
          </a>
        )}
      </div>
      {body}
      <div className="bal-f">Saldo kontrak escrow di BNB Smart Chain Testnet — budget dan bond yang belum dibagikan.</div>
    </div>
  );
}

/** Nilai rincian wallet, atau "—" beralasan kalau daftarnya terpotong di batas server. */
function SplitValue({ value, truncated, what }: { value: bigint | null; truncated: boolean; what: string }) {
  if (value === null) return <Sk w={80} h={18} style={{ marginTop: 3 }} />;
  if (truncated) return <b title={`Lebih dari ${what} — total tidak bisa dihitung di browser`}>—</b>;
  return <b><Money wei={value} /></b>;
}

function WalletSplit({ address }: { address: string }) {
  const jobs = useJobs({ wallet: address, limit: LIMITS.jobs });
  const act = useActivity({ limit: LIMITS.activity });
  const locked = jobs.data ? lockedFor(jobs.data.jobs, address) : null;
  const got = act.data ? receivedBy(act.data, address) : null;
  return (
    <div className="bal-split">
      <div>
        <span>Terkunci atas nama Anda</span>
        {jobs.isError ? <b>—</b> : <SplitValue value={locked} truncated={!!jobs.data && jobs.data.total > jobs.data.jobs.length} what={`${LIMITS.jobs} kontrak`} />}
      </div>
      <div>
        <span>Diterima dari kontrak</span>
        {act.isError ? <b>—</b> : <SplitValue value={got} truncated={!!act.data && act.data.length >= LIMITS.activity} what={`${LIMITS.activity} aktivitas`} />}
      </div>
    </div>
  );
}

function WalletCard() {
  const w = useWallet();
  const { openConnect } = useWalletUi();
  const [copied, setCopied] = useState(false);
  // Chain mati: kolom jobs berisi data seed yang tidak ada di kontrak.
  const devMode = useChainInfo().data?.chainEnabled === false;

  if (w.restoring) {
    return (
      <div className="card bal">
        <div className="bal-top"><span className="bal-l"><Icon name="wallet" />Wallet saya</span></div>
        <Sk w="55%" h={30} style={{ marginTop: 18 }} />
      </div>
    );
  }
  if (!w.address) {
    return (
      <div className="card bal">
        <div className="bal-top"><span className="bal-l"><Icon name="wallet" />Wallet saya</span></div>
        <div className="bal-empty">
          <p>Hubungkan wallet untuk melihat saldo dan kontrak yang melibatkan Anda.</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={openConnect}><Icon name="wallet" />Hubungkan wallet</button>
        </div>
      </div>
    );
  }
  const copy = async () => { try { await navigator.clipboard.writeText(w.address!); setCopied(true); } catch { /* clipboard ditolak browser: alamat tetap terlihat */ } };
  return (
    <div className="card bal">
      <div className="bal-top">
        <span className="bal-l"><Icon name="wallet" />Wallet saya</span>
        <span className="bal-addr mono" title={w.address}>
          {shortAddr(w.address)}
          <button type="button" className="copy" onClick={copy} aria-label={copied ? 'Alamat disalin' : 'Salin alamat'}><Icon name={copied ? 'check' : 'copy'} /></button>
        </span>
      </div>
      <div className="bal-n"><WalletBalance address={w.address} /></div>
      <WalletSplit address={w.address} />
      <div className="bal-f">
        {w.walletName} · BNB Smart Chain Testnet
        {devMode && <> · rincian di atas dari database (mode pengembangan), bukan dari kontrak</>}
      </div>
    </div>
  );
}

function Stat({ icon, label, value, hint }: { icon: IconName; label: string; value: ReactNode; hint: string }) {
  return (
    <div className="stat">
      <div className="stat-l"><span className="stat-ic"><Icon name={icon} /></span>{label}</div>
      <div className="stat-n">{value}</div>
      <div className="stat-h">{hint}</div>
    </div>
  );
}

/** Tiga dari empat angka milik wallet aktif; "Perlu juri" berlaku untuk seluruh pasar. */
function StatsCard() {
  const w = useWallet();
  const stats = useStats(w.address ?? null);
  const v = (n: number | undefined, needsWallet: boolean): ReactNode => {
    if (needsWallet && !w.address) return w.restoring ? <Sk w={36} h={26} /> : '—';
    if (stats.isPending) return <Sk w={36} h={26} />;
    if (stats.isError || n === undefined) return '—';
    return <span className="num">{n}</span>;
  };
  const hint = (connected: string) => (w.address ? connected : 'Hubungkan wallet');
  return (
    <div className="card stats">
      <Stat icon="wallet" label="Sebagai client" value={v(stats.data?.asClient, true)} hint={hint('Kontrak yang Anda danai')} />
      <Stat icon="briefcase" label="Sebagai freelancer" value={v(stats.data?.asFreelancer, true)} hint={hint('Kontrak yang Anda kerjakan')} />
      <Stat icon="scale" label="Perlu juri" value={v(stats.data?.needJury, false)} hint="Seluruh pasar, zona abu" />
      <Stat icon="check" label="Selesai" value={v(stats.data?.done, true)} hint={hint('Kontrak Anda yang tuntas')} />
    </div>
  );
}

function RecentJobs() {
  const q = useJobs({ limit: 3 });
  if (q.isPending) return <JobGridSkeleton count={3} />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (q.data.jobs.length === 0) {
    return (
      <EmptyState icon="store" title="Belum ada kontrak" action={<ButtonLink href="/create" icon="plus">Buat kontrak</ButtonLink>}>
        Kontrak GEO pertama akan muncul di sini begitu dibuat.
      </EmptyState>
    );
  }
  return <JobGrid jobs={q.data.jobs} />;
}

export function DashboardView() {
  return (
    <>
      <ArbiterAdmin />
      <div className="bal-grid">
        <WalletCard />
        <LockedHero />
      </div>
      <StatsCard />
      <div className="sec-head">
        <h2>Kontrak terbaru</h2>
        <Link href="/market">Lihat pasar <Icon name="arrow" className="i-sm" /></Link>
      </div>
      <RecentJobs />
    </>
  );
}
