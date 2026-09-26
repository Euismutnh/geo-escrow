'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useWallet } from '@/components/wallet/useWallet';
import { useWalletUi } from '@/components/wallet/WalletUi';
import { apiPost, ApiClientError } from '@/lib/api';
import { isTxHash, shortHash, txUrl } from '@/lib/explorer';
import type { VerifyResult } from '@/lib/flows/verify';
import { invalidateAfterChange } from '@/lib/invalidate';
import { verifyOutcome, type OracleAction, type OracleOffer } from '@/lib/job-view';
import { oracleActionKey } from '@/lib/queries';
import type { Relation } from '@/lib/tx';

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
        return await apiPost<Result>(PATH[offer.kind](jobId), {});
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
