import type { ReactNode } from 'react';

/** Judul halaman. Subjudul satu kalimat — jangan menjelaskan konsep produk di sini. */
export function PageHeader({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {action}
    </div>
  );
}
