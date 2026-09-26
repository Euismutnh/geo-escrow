'use client';

import { useState, type ReactNode } from 'react';
import { useConfig, useReadContract } from 'wagmi';
import { readContract } from 'wagmi/actions';
import { TxButton } from '@/components/tx/TxButton';
import { Icon } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { useWallet } from '@/components/wallet/useWallet';
import { geoEscrowAbi } from '@/lib/abi';
import { ApiClientError } from '@/lib/api';
import type { ChainInfo } from '@/lib/chain-server';
import { acceptGuard, draftKey, ensureDeliverable, postDeliverable, submitGuard } from '@/lib/deliverable';
import { shortHash } from '@/lib/explorer';
import { contentHash } from '@/lib/hash';
import { LIMITS } from '@/lib/job-input';
import type { UiStatus } from '@/lib/status';
import { textHitsBrand } from '@/lib/brand-match';
import { checkStructural, MIN_DELIVERABLE_LENGTH } from '@/lib/structural';
import { isBusy, type TxPhase } from '@/lib/tx';
import type { ActivityEntry, Job } from '@/lib/types';
import { CHAIN } from '@/lib/wagmi';

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="card"><div className="card-h"><h3>{title}</h3></div><div className="card-b stack">{children}</div></section>;
}

const bps = (v: string | null | undefined) => (v && /^\d+$/.test(v) ? BigInt(v) : null);

// ---------------------------------------------------------------------
// Ambil kontrak — acceptJob{ value: requiredBond(jobId) }
// ---------------------------------------------------------------------

/**
 * Bond DIBACA dari kontrak (requiredBond), tidak pernah dihitung (§A10):
 * acceptJob menolak value yang tidak persis sama ("GEO: nilai bond tidak
 * sesuai"). Nilai yang ditampilkan dan nilai yang dikirim sama-sama dari
 * view itu — yang dikirim dibaca ULANG saat tombol ditekan.
 */
export function AcceptCard({ job, ui, chain, now }: { job: Job; ui: UiStatus; chain: ChainInfo | undefined; now: number | null }) {
  const config = useConfig();
  const { address } = useWallet();
  const contract = chain?.contractAddress as `0x${string}` | undefined;
  const bond = useReadContract({
    address: contract,
    abi: geoEscrowAbi,
    functionName: 'requiredBond',
    args: [BigInt(job.job_id)],
    chainId: CHAIN.id,
    query: { enabled: !!contract },
  });
  const budget = BigInt(job.budget_wei);
  const sBps = bps(chain?.structuralBps);
  const structural = sBps !== null ? (budget * sBps) / 10000n : null;

  return (
    <Card title="Ambil kontrak ini">
      <dl className="sum" style={{ margin: 0 }}>
        <div className="sum-row">
          <dt>Bond yang harus dikunci</dt>
          <dd>{bond.data !== undefined ? <Money wei={bond.data} /> : bond.isError ? '—' : '…'}</dd>
        </div>
        {structural !== null && (
          <div className="sum-row"><dt>Cair saat lolos cek struktural · {Number(sBps) / 100}%</dt><dd>≈ <Money wei={structural} /></dd></div>
        )}
        {structural !== null && bond.data !== undefined && (
          <div className="sum-row"><dt>Sisanya kalau target tercapai</dt><dd>≈ <Money wei={budget - structural} /> + bond</dd></div>
        )}
      </dl>
      <p className="hint" style={{ margin: 0 }}>
        Bond dikembalikan penuh jika target tercapai, dan dialihkan ke client jika tidak. Baseline saat ini {job.baseline_score ?? '—'} dari {job.queries.length}; target {job.target_count}.
      </p>
      <TxButton
        label="Ambil kontrak · kunci bond"
        icon="lock"
        syncJobId={job.job_id}
        allowed={acceptGuard(job, ui, address, chain, now)}
        prepare={async () => {
          if (!contract) throw new Error('Alamat kontrak tidak terbaca');
          const value = await readContract(config, { address: contract, abi: geoEscrowAbi, functionName: 'requiredBond', args: [BigInt(job.job_id)], chainId: CHAIN.id });
          return { functionName: 'acceptJob', args: [BigInt(job.job_id)] as const, value };
        }}
        doneMessage="Kontrak diambil dan bond terkunci. Silakan kirim hasil kerja."
      />
    </Card>
  );
}

// ---------------------------------------------------------------------
// Kirim hasil — POST konten DULU, tanda tangan belakangan
// ---------------------------------------------------------------------

const readDraft = (jobId: number) => { try { return localStorage.getItem(draftKey(jobId)) ?? ''; } catch { return ''; } };
const writeDraft = (jobId: number, v: string) => { try { localStorage.setItem(draftKey(jobId), v); } catch { /* private mode */ } };
const clearDraft = (jobId: number) => { try { localStorage.removeItem(draftKey(jobId)); } catch { /* abaikan */ } };

/**
 * Urutan dikunci (blueprint Fase 7, handover §3.2):
 *   1. POST /api/jobs/:id/deliverable — structural check di server, GRATIS
 *   2. submitDeliverable(jobId, hash) — hash dari respons langkah 1
 *   3. POST /api/sync/:id — route itu memicu confirmStructural (cair 20%)
 *
 * Kalau tab ditutup di antara 1 dan 2, konten tidak hilang: saat halaman
 * dibuka lagi, isian diambil dari draf di browser ini atau dari server,
 * lalu cukup diperiksa ulang (gratis) untuk mendapat hash-nya.
 *
 * Draf lokal didahulukan: sebelum tanda tangan, konten di server bisa
 * ditimpa siapa pun (lib/deliverable-lock.ts), sedangkan draf lokal pasti
 * tulisan freelancer sendiri.
 */
export function DeliverableCard({ job, rejected }: { job: Job; rejected: ActivityEntry | null }) {
  const { address } = useWallet();
  const serverText = job.deliverable_content?.trim() ?? '';

  const [text, setText] = useState(() => readDraft(job.job_id) || serverText);
  const [checked, setChecked] = useState<{ text: string; hash: `0x${string}` } | null>(null);
  const [checking, setChecking] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [phase, setPhase] = useState<TxPhase>('idle');

  const trimmed = text.trim();
  const local = checkStructural(trimmed, job.brand); // aturan SAMA dengan server
  const hitsBrand = textHitsBrand(trimmed, job.brand);
  const ready = checked !== null && checked.text === trimmed;
  const locked = checking || isBusy(phase) || phase === 'done' || phase === 'sync_failed' || phase === 'unknown';

  const check = async () => {
    setErr(null);
    setChecking(true);
    try {
      const r = await postDeliverable(job.job_id, trimmed);
      setChecked({ text: trimmed, hash: r.hash });
    } catch (e) {
      // STRUCTURAL_FAILED membawa kalimat spesifik dari server — tampil di tempat, bukan toast.
      setErr(e instanceof ApiClientError || e instanceof Error ? e.message : 'Konten belum bisa diperiksa. Coba lagi.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <Card title="Kirim hasil optimasi">
      {rejected && (
        <div className="note note-warn">
          <Icon name="alert" />
          <div>
            <b>Kiriman sebelumnya ditolak cek struktural.</b> Bond Anda tetap utuh — perbaiki lalu kirim ulang.
            {(rejected.note || job.last_error) && <div className="err-line warn">{rejected.note || job.last_error}</div>}
          </div>
        </div>
      )}
      <div className="steps2" aria-hidden="true">
        <span className={ready ? 'ok' : 'on'}><b>{ready ? '✓' : '1'}</b>Periksa konten</span>
        <Icon name="right" className="i-xs" />
        <span className={ready ? 'on' : undefined}><b>2</b>Tanda tangani &amp; kirim</span>
      </div>
      <div>
        <div className="label">
          <label htmlFor={`f-deliv-${job.job_id}`}>Konten yang sudah dioptimasi</label>
          <span className="counter">{trimmed.length.toLocaleString('id-ID')} / {LIMITS.deliverable.toLocaleString('id-ID')}</span>
        </div>
        <textarea
          id={`f-deliv-${job.job_id}`}
          className="textarea"
          rows={7}
          maxLength={LIMITS.deliverable}
          value={text}
          readOnly={locked}
          placeholder={`Tulis konten yang sudah dioptimasi. Sebutkan "${job.brand}" secara eksplisit.`}
          onChange={(e) => { setText(e.target.value); writeDraft(job.job_id, e.target.value); setErr(null); }}
        />
        <ul className="checks">
          <li className={trimmed.length >= MIN_DELIVERABLE_LENGTH ? 'ok' : undefined}>
            <Icon name={trimmed.length >= MIN_DELIVERABLE_LENGTH ? 'check' : 'dot'} />Minimal {MIN_DELIVERABLE_LENGTH} karakter <span className="num">({trimmed.length})</span>
          </li>
          <li className={hitsBrand ? 'ok' : undefined}>
            <Icon name={hitsBrand ? 'check' : 'dot'} />Menyebut “{job.brand}” secara eksplisit
          </li>
        </ul>
      </div>

      {ready ? (
        <div className="stack">
          <div className="note note-ok">
            <Icon name="check" />
            <div><b>Lolos cek struktural.</b> Konten tersimpan di server. Hash yang akan Anda tandatangani: <span className="mono" title={checked.hash}>{shortHash(checked.hash)}</span></div>
          </div>
          <TxButton
            label="Tanda tangani & kirim"
            icon="lock"
            syncJobId={job.job_id}
            allowed={submitGuard(job, address)}
            onPhase={setPhase}
            prepare={() => {
              // Yang ditandatangani HARUS hash konten yang sedang tampil.
              if (contentHash(trimmed).toLowerCase() !== checked.hash.toLowerCase()) throw new Error('Konten berubah setelah diperiksa — periksa ulang dulu.');
              return { functionName: 'submitDeliverable', args: [BigInt(job.job_id), checked.hash] as const };
            }}
            afterReceipt={async () => {
              await ensureDeliverable(job.job_id, trimmed, checked.hash);
              clearDraft(job.job_id);
            }}
            doneMessage="Hash konten terkunci on-chain. Oracle sedang mengonfirmasi cek struktural — sebagian budget cair setelahnya."
          />
        </div>
      ) : (
        <div className="stack">
          {err && <div className="note note-err" role="alert"><Icon name="alert" /><div><b>Belum lolos.</b> {err}</div></div>}
          {checked && checked.text !== trimmed && <p className="hint" style={{ margin: 0 }}>Konten berubah sejak diperiksa — periksa ulang sebelum menandatangani.</p>}
          <div className="txw">
            <button type="button" className="btn btn-secondary" onClick={check} disabled={!local.pass || checking}>
              {checking ? <span className="spin" aria-hidden="true" /> : <Icon name="shield" />}{checking ? 'Memeriksa…' : 'Periksa konten'}
            </button>
            <p className="hint" style={{ margin: 0 }}>Pemeriksaan gratis dan dilakukan sebelum Anda membayar gas. Draf tetap tersimpan di browser ini meski halaman ditutup.</p>
          </div>
        </div>
      )}
    </Card>
  );
}
