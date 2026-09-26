/**
 * Avatar gradien dari alamat (mockup avatar()). Deterministik: alamat
 * yang sama → warna yang sama di sidebar, menu, dan kartu mana pun.
 * Huruf diturunkan dulu supaya checksum dan huruf-kecil tidak berbeda.
 */
export function Avatar({ address, size = 22 }: { address: string; size?: number }) {
  const a = address.toLowerCase();
  const h1 = parseInt(a.slice(2, 6), 16) % 360;
  const h2 = (h1 + 50 + (parseInt(a.slice(-3), 16) % 110)) % 360;
  return (
    <span
      className="av"
      aria-hidden="true"
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h1} 60% 60%), hsl(${h2} 55% 42%))` }}
    />
  );
}
