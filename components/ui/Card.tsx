import type { ReactNode } from 'react';

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `card ${className}` : 'card'}>{children}</section>;
}

/** Judul kartu. Sengaja tanpa ikon — chip ikon di tiap judul adalah pola template generik. */
export function CardHeader({ title, meta }: { title: ReactNode; meta?: ReactNode }) {
  return (
    <div className="card-h">
      <h3>{title}</h3>
      {meta != null && <span className="meta">{meta}</span>}
    </div>
  );
}

export function CardBody({ children }: { children: ReactNode }) {
  return <div className="card-b">{children}</div>;
}
