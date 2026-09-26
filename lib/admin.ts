import { getAddress, isAddress } from 'viem';

const lc = (a: string | null | undefined) => (a ? a.toLowerCase() : '');
const ZERO = /^0x0{40}$/i;

export type ArbiterCheck =
  | { ok: true; address: `0x${string}` }
  | { ok: false; reason: string };

/**
 * Validasi alamat arbiter BARU sebelum owner menandatangani setArbiter().
 *
 * Kontrak hanya menolak alamat nol. Sisanya di sini adalah kesalahan yang
 * lolos di kontrak tapi merusak alur:
 *   - checksum salah: satu karakter salah ketik = peran jatuh ke alamat
 *     tak bertuan (getAddress menolak huruf campuran yang checksum-nya salah)
 *   - owner/client sebagai arbiter: relationToJob() menampilkan wallet itu
 *     sebagai CLIENT di job miliknya, jadi panel juri tidak pernah muncul —
 *     dan client yang memutus sengketanya sendiri bukan sengketa
 *   - Oracle sebagai arbiter: pihak yang zona abunya dipersoalkan ikut memutus
 */
export function checkNewArbiter(
  input: string,
  ctx: { current: string | null; owner: string | null; oracle: string | null; me: string | null }
): ArbiterCheck {
  const raw = input.trim();
  if (!raw) return { ok: false, reason: 'Tempel alamat wallet arbiter baru.' };
  if (!/^0x[0-9a-fA-F]{40}$/.test(raw)) return { ok: false, reason: 'Bukan alamat wallet: harus 0x diikuti 40 karakter heksadesimal.' };
  // getAddress() SAJA tidak cukup: viem memanggilnya dengan strict:false,
  // jadi alamat huruf-campuran yang checksum-nya salah tetap diterima
  // (terbukti di check-pure). isAddress strict menolaknya; huruf kecil
  // semua tetap diterima (tanpa checksum = tidak ada klaim yang bisa salah).
  if (!isAddress(raw, { strict: true })) {
    return { ok: false, reason: 'Checksum alamat tidak cocok — salin ulang pakai tombol copy di wallet, jangan diketik manual.' };
  }
  const address = getAddress(raw);
  if (ZERO.test(address)) return { ok: false, reason: 'Alamat nol tidak boleh.' };
  if (lc(address) === lc(ctx.current)) return { ok: false, reason: 'Alamat itu sudah menjadi arbiter.' };
  if (lc(address) === lc(ctx.owner) || lc(address) === lc(ctx.me)) return { ok: false, reason: 'Arbiter harus wallet TERPISAH dari owner/client — kalau sama, panel juri tidak muncul di kontrak miliknya.' };
  if (lc(address) === lc(ctx.oracle)) return { ok: false, reason: 'Arbiter tidak boleh sama dengan Oracle — arbiter justru memutus kasus yang tidak bisa diputus Oracle.' };
  return { ok: true, address };
}
