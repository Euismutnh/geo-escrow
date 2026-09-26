'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useWallet } from '@/components/wallet/useWallet';
import { useWalletUi } from '@/components/wallet/WalletUi';
import { api, apiPost, ApiClientError } from '@/lib/api';
import { draftKey, ensureDeliverable } from '@/lib/deliverable';
import { isTxHash, shortHash, txUrl } from '@/lib/explorer';
import { contentHash } from '@/lib/hash';
import type { VerifyResult } from '@/lib/flows/verify';
import { invalidateAfterChange } from '@/lib/invalidate';
import { verifyOutcome, type OracleAction, type OracleOffer } from '@/lib/job-view';
import { oracleActionKey } from '@/lib/queries';
import type { Relation } from '@/lib/tx';
import type { Job } from '@/lib/types';

/*
 * Tombol yang MEMICU kerja Oracle di server — tanpa transaksi dari wallet
 * user, jadi tidak lewat <TxButton>. Endpoint & bentuk responsnya tidak
 * diubah:
 *   verify   POST /api/jobs/:id/verify    -> VerifyResult
 *   sync     POST /api/sync/:id           -> HasilSync (after() memicu confirmStructural)
 *   baseline POST /api/jobs/:id/baseline  -> { score, of, fromCache }
 */
const PATH: Record<OracleAction, (id: number) => string> = {
  verify: (id) => `/api/jobs/${id}/verify`,
  sync: (id) => `/api/sync/${id}`,
  baseline: (id) => `/api/jobs/${id}/baseline`,
};

const ICON: Record<OracleAction, IconName> = { verify: 'shield', sync: 'refresh', baseline: 'refresh' };

const BUSY: Record<OracleAction, string> = {
  verify: 'Oracle memverifikasi…',
  sync: 'Memicu konfirmasi…',
  baseline: 'Mengukur baseline…',
};

const WHAT: Record<OracleAction, string> = {
  verify: 'memicu verifikasi',
  sync: 'memicu konfirmasi ulang',
  baseline: 'mengukur ulang baseline',
};

type Result = VerifyResult | { score: number; of: number } | Record<string, unknown>;

function successNote(kind: OracleAction, r: Result): { tone: 'ok' | 'warn'; text: string; tx: string | null } {
  if (kind === 'verify') {
    const v = r as VerifyResult;
    return { ...verifyOutcome(v), tx: isTxHash(v.txHash) ? v.txHash : null };
  }
  if (kind === 'baseline') {
    const b = r as { score: number; of: number };
    return { tone: 'ok', text: `Baseline terukur: ${b.score} dari ${b.of} pertanyaan menyebut brand.`, tx: null };
  }
  return { tone: 'ok', text: 'Konfirmasi dipicu. Status diperbarui otomatis begitu Oracle selesai.', tx: null };
}

function errorNote(e: unknown): { tone: 'info' | 'err'; text: string } {
  if (e instanceof ApiClientError) {
    // BUSY bukan kegagalan: proses lain (tab lain, cron) sedang mengerjakannya.
    if (e.code === 'BUSY') return { tone: 'info', text: 'Oracle sedang mengerjakan kontrak ini — hasilnya muncul otomatis di halaman ini.' };
    // Pesan server sudah disaring publicErrorMessage (A21) — aman ditampilkan.
    return { tone: 'err', text: e.message };
  }
  return { tone: 'err', text: 'Kesalahan tak terduga. Muat ulang halaman lalu coba lagi.' };
}

/**
 * Hanya client & freelancer kontrak ini yang ditawari tombolnya. Endpoint
 * sendiri terbuka (dijaga rate limit + lock + status), tapi verifikasi
 * membakar kredit AI dan memindahkan dana — pengunjung lain cukup melihat
 * prosesnya.
 */
export function OracleActionButton({ jobId, offer, rel, primary = false }: {
  jobId: number;
  offer: OracleOffer;
  rel: Relation;
  /** Tombol utama langkah ini (mis. "Verifikasi sekarang"), bukan sekadar coba-lagi. */
  primary?: boolean;
}) {
  const qc = useQueryClient();
  const { address, restoring } = useWallet();
  const { openConnect } = useWalletUi();
  const m = useMutation({
    mutationKey: oracleActionKey(offer.kind, jobId),
    // Invalidasi di dalam mutationFn, bukan onSettled: saat verifikasi
    // berjalan, polling mengubah kartu jadi `verifying` dan tombol ini
    // LEPAS dari layar — yang terpasang di komponen tidak boleh diandalkan.
    mutationFn: async () => {
      try {
        const r = await apiPost<Result>(PATH[offer.kind](jobId), {});
        if (offer.kind === 'sync') await waitForPickup(jobId);
        return r;
      } finally {
        invalidateAfterChange(qc, jobId);
      }
    },
  });

  const cls = primary ? 'btn btn-primary' : 'btn btn-secondary';

  if (restoring) return <div className="txw"><button type="button" className={cls} disabled><span className="spin" aria-hidden="true" />Memulihkan wallet…</button></div>;
  if (!address) {
    return (
      <div className="txw">
        <button type="button" className="btn btn-secondary" onClick={openConnect}><Icon name="wallet" />Hubungkan wallet</button>
        <p className="tx-msg"><Icon name="info" /><span>Client atau freelancer kontrak ini bisa {WHAT[offer.kind]}.</span></p>
      </div>
    );
  }
  if (rel !== 'client' && rel !== 'freelancer') {
    return <p className="hint" style={{ margin: 0 }}>Hanya client atau freelancer kontrak ini yang bisa {WHAT[offer.kind]}. Halaman ini menampilkan hasilnya otomatis.</p>;
  }

  const ok = m.isSuccess ? successNote(offer.kind, m.data) : null;
  const bad = m.isError ? errorNote(m.error) : null;

  return (
    <div className="txw">
      <button type="button" className={m.isPending ? `${cls} busy` : cls} onClick={() => m.mutate()} disabled={m.isPending} aria-live="polite">
        {m.isPending ? <span className="spin" aria-hidden="true" /> : <Icon name={ICON[offer.kind]} />}
        {m.isPending ? BUSY[offer.kind] : offer.label}
      </button>
      {m.isPending && offer.kind === 'verify' && (
        <p className="tx-msg"><Icon name="clock" /><span>Bisa sampai 1 menit: Oracle bertanya ke AI, lalu mengirim settlement ke kontrak. Tidak perlu tanda tangan wallet.</span></p>
      )}
      {ok && (
        <p className={`tx-msg ${ok.tone}`}>
          <Icon name={ok.tone === 'ok' ? 'check' : 'alert'} />
          <span>{ok.text}{ok.tx && <> <a className="lnk mono" href={txUrl(ok.tx)} target="_blank" rel="noopener noreferrer">{shortHash(ok.tx)}<Icon name="ext" className="i-xs" /></a></>}</span>
        </p>
      )}
      {bad && <p className={bad.tone === 'err' ? 'tx-msg err' : 'tx-msg'}><Icon name={bad.tone === 'err' ? 'alert' : 'info'} /><span>{bad.text}</span></p>}
    </div>
  );
}

/**
 * POST /api/sync membalas SEBELUM confirmStructural mengambil lock (ia
 * berjalan di after()). Kalau halaman langsung menyegarkan, job masih
 * terbaca `error` — status yang tidak di-polling — dan layar diam padahal
 * Oracle baru saja mulai. Tunggu sebentar sampai kerja itu terlihat
 * (lock diambil = job_state bukan 'error' lagi, atau status sudah maju).
 * Selama menunggu, mutasi masih berjalan → useJob mem-polling.
 */
export async function waitForPickup(jobId: number, tries = 5, gapMs = 1_500): Promise<void> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, gapMs));
    try {
      const { job } = await api<{ job: Job }>(`/api/jobs/${jobId}`);
      if (job.status !== 'Submitted' || job.job_state !== 'error') return;
    } catch { return; /* halaman tetap menyegarkan lewat invalidasi */ }
  }
}

// ---------------------------------------------------------------------
// Kirim ulang konten yang DITANDATANGANI (temuan audit S-13)
// ---------------------------------------------------------------------

const readDraft = (jobId: number) => { try { return localStorage.getItem(draftKey(jobId)) ?? ''; } catch { return ''; } };
const clearDraft = (jobId: number) => { try { localStorage.removeItem(draftKey(jobId)); } catch { /* abaikan */ } };

/**
 * Konfirmasi struktural berhenti karena isi di server ≠ hash yang
 * ditandatangani freelancer (draf ditimpa sebelum tanda tangan, dan tab
 * ditutup sebelum kiriman ulang pasca-receipt). Hash on-chain tidak bisa
 * diubah — satu-satunya jalan keluar: kirim isi yang PERSIS sama.
 *
 * Tombol baru aktif kalau keccak256 teks di kotak = hash on-chain
 * (dihitung di browser), jadi tidak ada kiriman yang pasti ditolak
 * server (HASH_MISMATCH). Draf lokal dipakai kalau masih ada — ia baru
 * dihapus setelah kiriman pasca-receipt sukses, jadi pada kasus ini
 * biasanya masih tersimpan. Setelah terkirim, POST /api/sync memicu
 * confirmStructural lagi.
 */
export function ResendSignedContent({ job }: { job: Job }) {
  const qc = useQueryClient();
  const [text, setText] = useState(() => readDraft(job.job_id));
  const trimmed = text.trim();
  const signed = job.deliverable_hash; // cermin hash on-chain (route & indexer)
  const matches = !!signed && trimmed.length > 0 && contentHash(trimmed).toLowerCase() === signed.toLowerCase();

  const m = useMutation({
    mutationKey: oracleActionKey('sync', job.job_id),
    mutationFn: async () => {
      try {
        await ensureDeliverable(job.job_id, trimmed, signed!);
        clearDraft(job.job_id);
        await apiPost(`/api/sync/${job.job_id}`, {});
        await waitForPickup(job.job_id);
      } finally {
        invalidateAfterChange(qc, job.job_id);
      }
    },
  });

  return (
    <div className="stack">
      <div>
        <div className="label"><label htmlFor={`f-resend-${job.job_id}`}>Konten yang Anda tandatangani</label></div>
        <textarea id={`f-resend-${job.job_id}`} className="textarea" rows={6} value={text} readOnly={m.isPending}
          onChange={(e) => setText(e.target.value)} placeholder="Tempel konten PERSIS seperti saat Anda menandatangani." />
        <ul className="checks">
          <li className={matches ? 'ok' : undefined}>
            <Icon name={matches ? 'check' : 'dot'} />
            {matches ? 'Sama persis dengan hash on-chain' : 'Belum sama dengan hash on-chain'}
            {signed && <span className="mono"> · {shortHash(signed)}</span>}
          </li>
        </ul>
      </div>
      <div className="txw">
        <button type="button" className="btn btn-primary" onClick={() => m.mutate()} disabled={!matches || m.isPending}>
          {m.isPending ? <span className="spin" aria-hidden="true" /> : <Icon name="refresh" />}
          {m.isPending ? 'Mengirim ulang…' : 'Kirim ulang & konfirmasi'}
        </button>
        {!matches && trimmed.length > 0 && <p className="tx-msg"><Icon name="info" /><span>Satu karakter berbeda (termasuk spasi di tengah atau baris baru) sudah membuat hash-nya lain.</span></p>}
        {m.isSuccess && <p className="tx-msg ok"><Icon name="check" /><span>Konten terkirim. Oracle mengonfirmasi ulang — status diperbarui otomatis.</span></p>}
        {m.isError && <p className="tx-msg err"><Icon name="alert" /><span>{m.error instanceof ApiClientError || m.error instanceof Error ? m.error.message : 'Kesalahan tak terduga.'}</span></p>}
      </div>
    </div>
  );
}
