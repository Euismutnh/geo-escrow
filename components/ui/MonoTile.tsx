import type { CSSProperties } from 'react';

/**
 * Logo inisial brand. Hue dipilih dari set terkurasi TANPA ungu (keputusan
 * desain Fase 1), secara deterministik dari nama brand — brand yang sama
 * selalu mendapat warna yang sama di semua halaman.
 */
const HUES = [12, 26, 38, 148, 164, 182, 198, 212];

/** FNV-1a 32-bit — cukup untuk memilih warna, bukan untuk keamanan. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

export function initials(brand: string): string {
  const w = brand.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (w.length === 0) return '?';
  const second = w[1] ? w[1][0] : w[0].slice(1, 2);
  return (w[0][0] + (second ?? '')).toUpperCase();
}

export function MonoTile({ brand, size = 40 }: { brand: string; size?: number }) {
  const h = HUES[hash(brand) % HUES.length];
  return (
    <span
      className="mono-tile"
      aria-hidden="true"
      style={{ '--h': h, width: size, height: size, fontSize: Math.round(size * 0.38) } as CSSProperties}
    >
      {initials(brand)}
    </span>
  );
}
