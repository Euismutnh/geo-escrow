import Link from 'next/link';

/**
 * Tab penyaring berbasis URL (?filter=, ?phase=). Memakai tautan, bukan
 * state: filter bisa dibagikan lewat tautan dan tombol Kembali browser
 * berfungsi. `count` undefined = angkanya belum/tidak diketahui.
 */
export function SegLinks({ items, active, label }: {
  items: { key: string; label: string; href: string; count?: number }[];
  active: string;
  label: string;
}) {
  return (
    <div className="seg-wrap">
      <nav className="seg" aria-label={label}>
        {items.map((it) => (
          <Link key={it.key} href={it.href} scroll={false} aria-current={it.key === active ? 'page' : undefined}>
            {it.label}
            {it.count !== undefined && <span className="cnt">{it.count}</span>}
          </Link>
        ))}
      </nav>
    </div>
  );
}
