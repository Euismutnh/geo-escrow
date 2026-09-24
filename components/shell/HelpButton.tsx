'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@/components/ui/Icon';

/** Tombol "Cara kerja" + laci penjelasannya. Isi statis; hanya buka-tutupnya yang interaktif. */
export function HelpButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button type="button" className="icon-btn" aria-label="Cara kerja" title="Cara kerja" onClick={() => setOpen(true)}>
        <Icon name="help" />
      </button>
      {open && (
        <>
          <div className="drawer-bg" onClick={() => setOpen(false)} />
          <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="help-title">
            <div className="drawer-h">
              <h3 id="help-title">Cara kerja GEO Escrow</h3>
              <button type="button" className="icon-btn" aria-label="Tutup" onClick={() => setOpen(false)} autoFocus>
                <Icon name="x" />
              </button>
            </div>
            <div className="drawer-b">
              <ol className="hsteps">
                <li><b>Hubungkan wallet, bukan login</b>Alamat wallet adalah identitas Anda di seluruh aplikasi.</li>
                <li><b>Peran ditentukan otomatis</b>Kalau alamat Anda client sebuah kontrak, Anda melihat kontrol client. Kalau freelancer, kontrol freelancer. Satu wallet bisa berbeda peran di kontrak berbeda.</li>
                <li><b>Oracle mengukur baseline</b>Oracle bertanya ke AI untuk setiap pertanyaan dan mencatat apakah brand disebut — sebelum ada optimasi apa pun.</li>
                <li><b>Freelancer mengambil kontrak</b>dan mengunci bond 5% sebagai jaminan.</li>
                <li><b>Konten diperiksa, baru ditandatangani</b>Pemeriksaan gratis. Setelah lolos, freelancer menandatangani hash kontennya di blockchain dan 20% budget cair.</li>
                <li><b>Verifikasi</b>Pertanyaan diundi acak dari seed on-chain — siapa pun bisa mengulang undiannya. Oracle bertanya ulang dengan konten baru sebagai konteks.</li>
                <li><b>Settlement</b>Target tercapai: sisa budget dan bond ke freelancer. Gagal jelas: refund dan bond ke client. Zona abu: arbiter memutuskan.</li>
              </ol>
              <div className="note note-plain">
                <Icon name="info" />
                <div><b>Soal &ldquo;2 gaya penjawab&rdquo;.</b> Claude (ringkas) dan Claude (naratif) adalah dua gaya dari model yang sama — bukan dua mesin AI berbeda.</div>
              </div>
              <div className="quote">&ldquo;Trustless karena hasilnya diukur, bukan diklaim.&rdquo;</div>
            </div>
          </aside>
        </>
      )}
    </>
  );
}
