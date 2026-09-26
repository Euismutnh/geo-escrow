'use client';

import { ApiClientError } from '@/lib/api';
import { Icon } from './Icon';

/**
 * Keadaan gagal memuat. Kalimat utamanya bahasa manusia; kode & pesan
 * mentah server disembunyikan di balik "Detail teknis" (aturan tulisan
 * Fase 1). Error sistem tidak pernah memindahkan dana, jadi pesan
 * "dana tidak terpengaruh" selalu benar untuk halaman BACA.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const network = error instanceof ApiClientError && error.code === 'NETWORK';
  const detail = error instanceof ApiClientError ? `${error.code}${error.status ? ` · HTTP ${error.status}` : ''} — ${error.message}` : String(error);
  return (
    <div className="empty is-err" role="alert">
      <div className="empty-ic"><Icon name="alert" /></div>
      <h3>Tidak bisa memuat data</h3>
      <p>{network ? 'Koneksi ke server terputus. Periksa jaringan Anda, lalu coba lagi.' : 'Terjadi gangguan di server kami. Dana di kontrak tidak terpengaruh.'}</p>
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <Icon name="refresh" />Coba lagi
        </button>
      )}
      <details className="tech"><summary>Detail teknis</summary><code>{detail}</code></details>
    </div>
  );
}
