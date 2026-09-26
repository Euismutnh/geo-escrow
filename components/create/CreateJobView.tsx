'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useConfig } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { TxButton } from '@/components/tx/TxButton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { Sk } from '@/components/ui/Skeleton';
import { useTbnbBalance, useWallet } from '@/components/wallet/useWallet';
import { useWalletUi } from '@/components/wallet/WalletUi';
import { apiPost } from '@/lib/api';
import type { ChainInfo } from '@/lib/chain-server';
import {
  clearPending, DEV_ID_BASE, jobIdDevSaja, jobIdFromReceipt, makeSnapshot, parsePending,
  PENDING_EVENT, readPendingRaw, saveJobMetadata, savePending,
  type CreateSnapshot, type PendingCreate, type PendingRaw,
} from '@/lib/create-job';
import { isTxHash, shortHash, txUrl } from '@/lib/explorer';
import { formatTime } from '@/lib/format';
import { canonicalQueryPool } from '@/lib/hash';
import {
  checkDraft, EXAMPLE_DRAFT, FIELD_LABEL, firstInvalid, LIMITS, MIN_LEAD_MS, QUERY_MAX, QUERY_MIN, toLocalInput,
  type Draft, type DraftField,
} from '@/lib/job-input';
import { useChainInfo } from '@/lib/queries';
import { isBusy, type TxPhase } from '@/lib/tx';
import { useNow } from '@/lib/use-now';
import { CHAIN } from '@/lib/wagmi';

const EMPTY: Draft = { brand: '', brief: '', queries: '', target: '3', budget: '', deadline: '', multiEngine: false };
const DAY = 86_400_000;

// ---------------------------------------------------------------------
// Catatan transaksi tertunda (lib/create-job.ts) — dibaca tanpa efek.
// ---------------------------------------------------------------------

function subscribePending(cb: () => void) {
  window.addEventListener('storage', cb);
  window.addEventListener(PENDING_EVENT, cb);
  return () => { window.removeEventListener('storage', cb); window.removeEventListener(PENDING_EVENT, cb); };
}

/** Catatan tertunda milik wallet + kontrak ini, terlama dulu. */
function usePendingCreates(address: string, contract: string | null): PendingCreate[] {
  const raw = useSyncExternalStore(subscribePending, readPendingRaw, () => null);
  return useMemo(() => {
    let parsed: PendingRaw = { v2: null, v1: null };
    try { if (raw) parsed = JSON.parse(raw) as PendingRaw; } catch { /* abaikan */ }
    return parsePending(parsed, address, contract);
  }, [raw, address, contract]);
}

/**
 * Transaksi createJob yang SUDAH terkirim, tapi metadatanya belum tersimpan
 * (tab ditutup, jaringan putus, server menolak). Melanjutkannya memakai hash
 * yang SAMA — tidak ada transaksi baru, tidak ada dana yang dikunci dua kali.
 *
 * Kalau batas ambilnya sudah lewat, metadata tidak bisa disimpan lagi
 * (server menolak batas ambil yang lewat) — yang tersisa adalah menarik
 * dananya kembali dengan reclaimExpired, memakai jobId dari receipt.
 */
function PendingItem({ pending }: { pending: PendingCreate }) {
  const config = useConfig();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'err' | 'warn' | 'info'; text: string } | null>(null);
  /** jobId dari receipt, kalau batas ambil sudah lewat → tawarkan reclaim. */
  const [expiredId, setExpiredId] = useState<number | null>(null);
  const s = pending.snapshot;

  const resume = async () => {
    setBusy(true);
    setMsg(null);
    try {
      let receipt;
      try {
        receipt = await waitForTransactionReceipt(config, { hash: pending.hash, chainId: CHAIN.id, timeout: 60_000 });
      } catch {
        setMsg({ tone: 'warn', text: 'Transaksinya belum terkonfirmasi. Periksa di BscScan, lalu coba lagi beberapa saat lagi.' });
        return;
      }
      if (receipt.status !== 'success') {
        clearPending(pending.hash);
        setMsg({ tone: 'info', text: 'Transaksi itu revert — dana tidak pernah berpindah. Catatan dihapus.' });
        return;
      }
      const id = jobIdFromReceipt(receipt.logs, s);
      if (Number(s.deadlineSec) * 1000 <= Date.now()) {
        setExpiredId(id);
        setMsg({ tone: 'warn', text: `Batas ambil kontrak #${id} sudah lewat, jadi datanya tidak bisa disimpan lagi. Tarik kembali budget-nya ke wallet Anda.` });
        return;
      }
      await saveJobMetadata(s, id);
      await apiPost(`/api/sync/${id}`, {}).catch(() => undefined); // gagal = cron yang menyusul
      clearPending(pending.hash);
      router.push(`/jobs/${id}`);
    } catch (e) {
      setMsg({ tone: 'err', text: `Belum bisa disimpan: ${e instanceof Error ? e.message : 'kesalahan tak terduga'}` });
    } finally {
      setBusy(false);
    }
  };

  const dismiss = () => {
    if (window.confirm('Hapus catatan ini? Dananya tetap di kontrak, tapi tanpa data ini kontraknya tidak akan muncul di aplikasi.')) clearPending(pending.hash);
  };

  return (
    <div className="note note-warn" style={{ marginBottom: 20 }} role="alert">
      <Icon name="alert" />
      <div>
        <b>Ada kontrak “{s.brand}” yang transaksinya sudah terkirim, tapi datanya belum tersimpan.</b>{' '}
        Dana {<Money wei={s.budgetWei} />} sudah dikunci di kontrak. Lanjutkan penyimpanan memakai transaksi yang sama — tidak ada biaya baru.
        {' '}{isTxHash(pending.hash) && <a className="lnk mono" href={txUrl(pending.hash)} target="_blank" rel="noopener noreferrer">{shortHash(pending.hash)}</a>}
        {msg && <p className={msg.tone === 'info' ? 'tx-msg' : `tx-msg ${msg.tone}`} style={{ marginTop: 8 }}><Icon name={msg.tone === 'info' ? 'info' : 'alert'} /><span>{msg.text}</span></p>}
        <div className="note-actions">
          {expiredId === null
            ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={resume} disabled={busy}>
                {busy ? <span className="spin" aria-hidden="true" /> : <Icon name="refresh" />}{busy ? 'Menyimpan…' : 'Lanjutkan penyimpanan'}
              </button>
            )
            : (
              <TxButton
                label="Tarik kembali budget"
                icon="undo"
                syncJobId={null} // tanpa metadata: /api/sync menjawab NOT_FOUND
                prepare={() => ({ functionName: 'reclaimExpired', args: [BigInt(expiredId)] as const })}
                afterReceipt={async () => { clearPending(pending.hash); }}
                doneMessage="Budget kembali ke wallet Anda. Catatan dihapus."
              />
            )}
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss} disabled={busy}>Abaikan</button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------

function Field({ id, label, opt, error, hint, children }: { id: string; label: string; opt?: ReactNode; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label className="label" htmlFor={id}>{label}{opt && <span className="opt">{opt}</span>}</label>
      {children}
      <div className="errm" id={`${id}-err`} role={error ? 'alert' : undefined}>{error && <><Icon name="alert" /><span>{error}</span></>}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

function CreateForm({ address, chain, onTxSent, blocked }: {
  address: string;
  chain: ChainInfo;
  onTxSent: (hash: string) => void;
  /** Masih ada kontrak tertunda milik wallet ini — selesaikan dulu (S-14). */
  blocked: boolean;
}) {
  const router = useRouter();
  const now = useNow();
  const bal = useTbnbBalance(address);
  const [d, setD] = useState<Draft>(EMPTY);
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({});
  const [phase, setPhase] = useState<TxPhase>('idle');
  const [devBusy, setDevBusy] = useState(false);
  const [devMsg, setDevMsg] = useState<string | null>(null);
  /** Dibekukan saat tombol diklik — dipakai tx DAN POST (dan percobaan ulangnya). */
  const snap = useRef<CreateSnapshot | null>(null);
  const jobIdRef = useRef<number | null>(null);
  const sentHash = useRef<string | null>(null);

  const contract = chain.contractAddress;
  // Sejak hash didapat, isian SUDAH terkunci di chain — form tidak boleh diubah lagi.
  const locked = isBusy(phase) || phase === 'done' || phase === 'sync_failed' || phase === 'unknown' || devBusy;
  const c = checkDraft(d, now ?? 0, bal.data?.value ?? null);
  const bad = firstInvalid(c.errors);
  const first = bad ? `${FIELD_LABEL[bad.field]}: ${bad.message}${bad.others ? ` (dan ${bad.others} isian lain)` : ''}` : null;
  const valid = now !== null && !first;
  const err = (f: DraftField) => (touched[f] ? c.errors[f] : undefined);
  const on = (f: keyof Draft) => (e: { target: { value: string } }) => {
    setD((x) => ({ ...x, [f]: e.target.value }));
    // Pemilih tanggal-jam sering tidak memicu blur — tandai saat berubah,
    // supaya "Minimal 1 jam" langsung terlihat di kolomnya (§A7).
    if (f === 'deadline') setTouched((t) => ({ ...t, deadline: true }));
  };
  const blur = (f: DraftField) => () => setTouched((t) => ({ ...t, [f]: true }));
  const touchAll = () => setTouched({ brand: true, brief: true, queries: true, target: true, budget: true, deadline: true });
  /** Tandai semua kolom yang salah, lalu bawa pengguna ke kolom pertama. */
  const showErrors = () => {
    touchAll();
    if (!bad) return;
    const el = document.getElementById(`f-${bad.field}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el?.focus({ preventScroll: true });
  };

  const bps = (v: string | null) => (v && /^\d+$/.test(v) ? BigInt(v) : null);
  const bondBps = bps(chain.bondBps), structBps = bps(chain.structuralBps);
  const budget = c.budgetWei ?? 0n;

  let canonical = '';
  try { canonical = canonicalQueryPool({ brand: c.brand, queries: c.queries, targetCount: Number.isInteger(c.targetCount) ? c.targetCount : 0, multiEngine: d.multiEngine }); }
  catch (e) { canonical = e instanceof Error ? e.message : ''; }

  const freeze = () => {
    const fresh = checkDraft(d, Date.now(), bal.data?.value ?? null);
    if (Object.keys(fresh.errors).length) { touchAll(); throw new Error('Periksa kembali isian yang ditandai.'); }
    const s = makeSnapshot(fresh, d.multiEngine, address, contract ?? 'dev');
    snap.current = s;
    return s;
  };

  /** §A8 — HANYA saat CHAIN_ENABLED=false: tanpa transaksi, jobId dari rentang dev. */
  const devCreate = async () => {
    setDevMsg(null);
    let s: CreateSnapshot;
    try { s = freeze(); } catch (e) { setDevMsg(e instanceof Error ? e.message : String(e)); return; }
    setDevBusy(true);
    try {
      let id = await jobIdDevSaja();
      try { await saveJobMetadata(s, id); }
      catch { id += 1; await saveJobMetadata(s, id); } // dua tab bersamaan: coba +1 sekali (§A8)
      router.push(`/jobs/${id}`);
    } catch (e) {
      setDevMsg(`Gagal menyimpan: ${e instanceof Error ? e.message : 'kesalahan tak terduga'}`);
      setDevBusy(false);
    }
  };

  const quick = (days: number) => {
    setD((x) => ({ ...x, deadline: toLocalInput(Date.now() + days * DAY) }));
    setTouched((t) => ({ ...t, deadline: true }));
  };

  return (
    <div className="card form">
      <div className="fsec">
        <div className="fsec-h">
          <div><h3>Brand</h3><p>Nama brand dan pertanyaan dikunci di blockchain setelah kontrak dibuat.</p></div>
          <button type="button" className="btn btn-ghost btn-sm" disabled={locked} onClick={() => setD((x) => ({ ...EXAMPLE_DRAFT, deadline: x.deadline || toLocalInput(Date.now() + 3 * DAY) }))}>
            <Icon name="spark" />Muat contoh
          </button>
        </div>
        <Field id="f-brand" label="Nama brand" error={err('brand')}>
          <input id="f-brand" className={err('brand') ? 'input err' : 'input'} value={d.brand} onChange={on('brand')} onBlur={blur('brand')}
            maxLength={LIMITS.brand} placeholder="mis. Root & Bloom" autoComplete="off" readOnly={locked} aria-invalid={!!err('brand')} aria-describedby="f-brand-err" />
        </Field>
        <Field id="f-brief" label="Ringkasan brief" opt="Opsional · tidak di-hash" error={err('brief')}>
          <textarea id="f-brief" className={err('brief') ? 'textarea err' : 'textarea'} rows={2} value={d.brief} onChange={on('brief')} onBlur={blur('brief')}
            maxLength={LIMITS.brief} placeholder="Brand apa, dan hasil seperti apa yang diinginkan?" readOnly={locked} aria-describedby="f-brief-err" />
        </Field>
      </div>

      <div className="fsec">
        <div className="fsec-h"><div><h3>Query pool</h3><p>Diajukan ke AI sebelum dan sesudah optimasi.</p></div></div>
        <Field id="f-queries" label="Pertanyaan" opt={<span className="num">{c.queries.length} terdeteksi · {QUERY_MIN}–{QUERY_MAX} · satu per baris</span>} error={err('queries')}>
          <textarea id="f-queries" className={err('queries') ? 'textarea err' : 'textarea'} rows={6} value={d.queries} onChange={on('queries')} onBlur={blur('queries')}
            placeholder="Apa rekomendasi skincare organik terbaik di Indonesia?" readOnly={locked} aria-invalid={!!err('queries')} aria-describedby="f-queries-err" />
        </Field>
        <div className="grid-2" style={{ marginTop: 18 }}>
          <Field id="f-target" label="Target" opt={`dari ${c.queries.length || 'N'} pertanyaan`} error={err('target')} hint="Berapa pertanyaan yang harus menyebut brand agar dana cair. Baseline diukur setelah kontrak dibuat — pilih target DI ATAS jumlah pertanyaan yang kira-kira sudah menyebut brand hari ini, supaya dana hanya cair kalau ada peningkatan.">
            <input id="f-target" className={err('target') ? 'input num err' : 'input num'} type="number" inputMode="numeric" min={1} max={Math.max(Math.min(c.queries.length, QUERY_MAX), 1)}
              value={d.target} onChange={on('target')} onBlur={blur('target')} readOnly={locked} aria-invalid={!!err('target')} aria-describedby="f-target-err" />
          </Field>
          <Field id="f-budget" label="Budget" error={err('budget')}
            hint={<>Saldo {bal.isPending ? 'sedang dibaca' : bal.data ? <Money wei={bal.data.value} short /> : 'tidak terbaca'}. Demo cukup 0,002–0,005 tBNB.</>}>
            <div className="affix">
              <input id="f-budget" className={err('budget') ? 'input num err' : 'input num'} inputMode="decimal" value={d.budget} onChange={on('budget')} onBlur={blur('budget')}
                placeholder="0,003" autoComplete="off" readOnly={locked} aria-invalid={!!err('budget')} aria-describedby="f-budget-err" />
              <span>tBNB</span>
            </div>
          </Field>
        </div>
        <label className="check" style={{ marginTop: 18 }}>
          <input type="checkbox" checked={d.multiEngine} disabled={locked} onChange={(e) => setD((x) => ({ ...x, multiEngine: e.target.checked }))} />
          <span>
            <b>Wajib lolos di 2 gaya penjawab</b>
            <span>Brand dihitung disebut hanya jika dua gaya jawaban Claude — ringkas dan naratif — sama-sama menyebutnya. Lebih ketat, dan pengukurannya dua kali lebih lama. Keduanya persona dari model yang sama, bukan dua mesin AI berbeda.</span>
          </span>
        </label>
      </div>

      <div className="fsec">
        <div className="fsec-h"><div><h3>Batas ambil</h3><p>Kalau tidak ada freelancer yang mengambil sampai batas ini, Anda bisa menarik kembali seluruh budget.</p></div></div>
        <div style={{ maxWidth: 360 }}>
          <Field id="f-deadline" label="Tanggal & jam" error={err('deadline')}
            hint={c.deadline ? <>Tutup {formatTime(c.deadline)} · minimal 1 jam dari sekarang.</> : 'Minimal 1 jam dari sekarang.'}>
            <input id="f-deadline" className={err('deadline') ? 'input err' : 'input'} type="datetime-local" value={d.deadline} onChange={on('deadline')} onBlur={blur('deadline')}
              min={now === null ? undefined : toLocalInput(now + MIN_LEAD_MS)} readOnly={locked} aria-invalid={!!err('deadline')} aria-describedby="f-deadline-err" />
          </Field>
          <div className="chips">
            {[1, 3, 7].map((n) => <button key={n} type="button" className="chip" disabled={locked} onClick={() => quick(n)}>+{n} hari</button>)}
          </div>
        </div>
      </div>

      <div className="fsec">
        <div className="fsec-h"><div><h3>Ringkasan biaya</h3></div></div>
        <dl className="sum">
          <div className="sum-row"><dt>Budget dikunci di kontrak</dt><dd><Money wei={budget} /></dd></div>
          {bondBps !== null && (
            <div className="sum-row"><dt>Perkiraan bond freelancer · {Number(bondBps) / 100}%</dt><dd>≈ <Money wei={(budget * bondBps) / 10000n} /></dd></div>
          )}
          {structBps !== null && (
            <div className="sum-row"><dt>Cair saat lolos cek struktural · {Number(structBps) / 100}%</dt><dd>≈ <Money wei={(budget * structBps) / 10000n} /></dd></div>
          )}
          <div className="sum-row"><dt>Biaya gas</dt><dd className="sans">Ditampilkan wallet sebelum Anda menyetujui</dd></div>
          <div className="sum-row total"><dt>Keluar dari wallet</dt><dd><Money wei={budget} /> + gas</dd></div>
        </dl>
        <p className="hint">Persentase dibaca dari kontrak dan hanya untuk gambaran. Bond yang sebenarnya dihitung kontrak saat kontrak diambil.</p>
        <details className="canon">
          <summary><Icon name="hash" className="i-sm" />Lihat data yang dikunci di blockchain</summary>
          <pre>{canonical}</pre>
        </details>
      </div>

      <div className="ffoot">
        <p>Oracle mulai mengukur baseline begitu data tersimpan — sekitar 10–20 detik. Setelah itu kontrak terbuka di pasar.</p>
        <div className="stack" style={{ minWidth: 0 }}>
          <TxButton
            label="Buat kontrak & kunci dana"
            icon="lock"
            syncJobId={null}
            allowed={
              blocked
                ? { ok: false, reason: 'Selesaikan dulu kontrak yang tertunda di atas — supaya dananya tidak terkunci tanpa tercatat.' }
                : valid ? { ok: true } : { ok: false, reason: now === null ? 'Memuat…' : first ?? '' }
            }
            prepare={() => {
              const s = freeze();
              // Tuple persis sesuai ABI: createJob(bytes32 queryPoolHash, uint64 acceptDeadline) payable.
              return { functionName: 'createJob', args: [s.queryPoolHash, BigInt(s.deadlineSec)] as const, value: BigInt(s.budgetWei) };
            }}
            onPhase={setPhase}
            onSent={(hash) => {
              sentHash.current = hash;
              onTxSent(hash);
              if (snap.current) savePending({ hash, snapshot: snap.current, at: Date.now() });
            }}
            afterReceipt={async (receipt) => {
              const s = snap.current;
              if (!s) throw new Error('data kontrak hilang dari memori — pakai "Lanjutkan penyimpanan" di atas');
              const id = jobIdFromReceipt(receipt.logs, s);
              jobIdRef.current = id;
              await saveJobMetadata(s, id);
              // Catatan disimpan di bawah hash SAAT TERKIRIM; tx yang dipercepat
              // di wallet punya hash lain di receipt. Hapus keduanya.
              if (sentHash.current) clearPending(sentHash.current);
              clearPending(receipt.transactionHash);
              return id; // <TxButton> lalu memanggil POST /api/sync/:id
            }}
            onDone={() => { if (jobIdRef.current !== null) router.push(`/jobs/${jobIdRef.current}`); }}
            doneMessage="Kontrak dibuat. Membuka halaman kontrak…"
          />
          {bad && now !== null && !blocked && !locked && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={showErrors}>
              <Icon name="alert" />Tunjukkan isian yang bermasalah
            </button>
          )}
          {chain.chainEnabled === false && (
            <div className="txw">
              <button type="button" className="btn btn-secondary" onClick={devCreate} disabled={devBusy || !valid}>
                {devBusy ? <span className="spin" aria-hidden="true" /> : <Icon name="plus" />}Buat tanpa blockchain (pengembangan)
              </button>
              <p className="tx-msg"><Icon name="info" /><span>Hanya menyimpan data ke database, jobId mulai {DEV_ID_BASE.toLocaleString('id-ID')} supaya tidak bertabrakan dengan job on-chain. Ditolak server di produksi.</span></p>
              {devMsg && <p className="tx-msg err"><Icon name="alert" /><span>{devMsg}</span></p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function CreateJobView() {
  const w = useWallet();
  const { openConnect } = useWalletUi();
  const info = useChainInfo();
  // Transaksi yang sedang berjalan di form ini tidak ditawarkan ulang di panel pemulihan.
  const [activeHash, setActiveHash] = useState<string | null>(null);
  const pending = usePendingCreates(w.address ?? '', info.data?.contractAddress ?? null).filter((p) => p.hash !== activeHash);

  if (w.restoring || info.isPending) return <div className="card form" style={{ padding: 24 }} aria-busy="true"><Sk h={38} /><Sk h={120} style={{ marginTop: 16 }} /></div>;
  if (!w.address) {
    return (
      <div className="form">
        <EmptyState icon="wallet" title="Wallet belum terhubung"
          action={<button type="button" className="btn btn-primary" onClick={openConnect}><Icon name="wallet" />Hubungkan wallet</button>}>
          Hubungkan wallet untuk membuat kontrak. Alamat yang terhubung akan tercatat sebagai client di blockchain.
        </EmptyState>
      </div>
    );
  }
  if (info.isError || !info.data) {
    return <div className="form"><EmptyState icon="alert" title="Konfigurasi kontrak tidak terbaca">Coba muat ulang halaman. Tanpa alamat kontrak, transaksi tidak bisa dibentuk.</EmptyState></div>;
  }
  return (
    <div className="form">
      {pending.map((p) => <PendingItem key={p.hash} pending={p} />)}
      <CreateForm key={w.address.toLowerCase()} address={w.address} chain={info.data} onTxSent={setActiveHash} blocked={pending.length > 0} />
    </div>
  );
}
