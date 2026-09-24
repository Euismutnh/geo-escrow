/**
 * Aturan tunggal untuk jobId yang datang sebagai STRING (path & query).
 * Murni — dipakai frontend (halaman /jobs/[id], breadcrumb) DAN backend
 * (parseJobId di lib/validate.ts), supaya keduanya tidak bisa berbeda.
 *
 * Yang diterima hanya desimal kanonik tanpa nol di depan, dan harus
 * Number.isSafeInteger:
 *
 *   diterima : "0"  "7"  "42"  "9007199254740991"
 *   ditolak  : ""  "abc"  "-1"  "+1"  " 1"  "1.0"  "1e1"  "0x10"  "007"
 *              "9007199254740992" (2^53 — tidak lagi aman sebagai number)
 *
 * Aturan lama (Number(raw) + isInteger) menerima "0x10" -> 16, "1e1" -> 10,
 * "007" -> 7, dan angka di atas 2^53 dengan presisi hilang. Akibatnya satu
 * job punya banyak alamat, dan id raksasa bisa membaca job yang salah.
 *
 * jobId pertama adalah 0 — `if (!id)` akan membuangnya (blueprint §A9),
 * jadi nilai kembali `null` berarti "tidak valid", BUKAN angka 0.
 */
const CANONICAL = /^(0|[1-9][0-9]*)$/;

export function parseJobIdParam(raw: string | null | undefined): number | null {
  if (raw == null || !CANONICAL.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
