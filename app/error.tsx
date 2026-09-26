'use client';

import { useEffect } from 'react';
import { ButtonLink } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/Icon';

/**
 * Error boundary untuk semua halaman (di dalam layout, jadi shell & wallet
 * tetap tampil). Tanpa ini satu nilai tak terduga — mis. wei yang rusak di
 * BigInt() — meruntuhkan seluruh aplikasi jadi layar kosong.
 *
 * Next 16.3: prop-nya `retry` (ambil ulang + render ulang), bukan `reset`
 * — node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
 *
 * `error.message` sengaja TIDAK ditampilkan: error dari komponen klien
 * membawa pesan aslinya, dan pesan viem memuat URL RPC + isi request
 * (aturan A21). Yang ditampilkan hanya `digest` untuk dicocokkan ke log.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error('[ui] halaman gagal dirender:', error);
  }, [error]);

  return (
    <EmptyState
      icon="alert"
      title="Halaman ini gagal ditampilkan"
      action={
        <span className="txw-row">
          <button type="button" className="btn btn-primary" onClick={() => retry()}><Icon name="refresh" />Coba lagi</button>
          <ButtonLink href="/" variant="secondary" icon="left">Kembali ke Ringkasan</ButtonLink>
        </span>
      }
    >
      Terjadi kesalahan saat menampilkan data. Dana di kontrak tidak terpengaruh — tampilan tidak bisa memindahkan dana.
      {error.digest && <> Kode: <span className="mono">{error.digest}</span></>}
    </EmptyState>
  );
}
