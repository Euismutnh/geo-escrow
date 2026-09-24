import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './http';
import { parseJobIdParam } from './route-params';

/** Alamat EVM: 0x + 40 hex. Disimpan & dibandingkan dalam huruf kecil. */
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

/**
 * Validasi alamat wallet dari query string.
 *
 * WAJIB dipakai sebelum alamat masuk ke filter PostgREST `.or()`.
 * Filter PostgREST berupa STRING yang di-parse server ("a.eq.X,b.eq.Y"),
 * jadi nilai yang mengandung koma, titik, atau kurung bisa mengubah arti
 * filternya -- injeksi filter. Supabase TIDAK mem-parameterkan bagian ini.
 *
 * Dengan regex ketat di sini, nilai yang lolos dijamin cuma [0-9a-f],
 * sehingga aman diinterpolasi.
 */
export function parseAddress(
  raw: string | null | undefined,
  field = 'wallet'
): string | undefined {
  if (raw === null || raw === undefined || raw === '') return undefined;
  const v = raw.trim().toLowerCase();
  if (!ADDRESS_RE.test(v)) {
    throw new ApiError('VALIDATION', `${field} bukan alamat yang valid`);
  }
  return v;
}

/** Sama, tapi untuk alamat di body request (wajib ada). */
export function requireAddress(raw: unknown, field: string): string {
  if (typeof raw !== 'string') {
    throw new ApiError('VALIDATION', `${field} wajib diisi`);
  }
  const v = parseAddress(raw, field);
  if (!v) throw new ApiError('VALIDATION', `${field} wajib diisi`);
  return v;
}

interface IntOpts {
  def: number;
  min: number;
  max: number;
}

/**
 * Bilangan bulat dari query string, dengan batas.
 *
 * Number('abc') menghasilkan NaN, dan NaN lolos begitu saja lewat
 * Math.max/Math.min -- lalu meledak jauh di dalam .range(NaN, NaN)
 * sebagai error 500 yang membingungkan. Di sini NaN ditangkap lebih awal.
 */
export function parseIntParam(
  raw: string | null | undefined,
  { def, min, max }: IntOpts
): number {
  if (raw === null || raw === undefined || raw === '') return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return def;
  return Math.min(max, Math.max(min, n));
}

/** job_id adalah bigint di database -- tolak yang bukan angka. */
export function parseJobId(raw: string): number {
  // Aturannya tinggal di lib/route-params.ts — satu sumber untuk backend
  // dan frontend. Versi lama memakai Number(raw) + isInteger, yang
  // menerima "0x10" (-> 16), "1e1" (-> 10), "007", dan angka di atas 2^53.
  const n = parseJobIdParam(raw);
  if (n === null) {
    throw new ApiError('VALIDATION', 'jobId tidak valid');
  }
  return n;
}

/**
 * Verifikasi header Authorization terhadap CRON_SECRET.
 *
 * Dua hal penting di sini:
 *
 * 1. Perbandingan TIDAK memakai `===`. Perbandingan string biasa berhenti
 *    di karakter pertama yang beda, sehingga lama eksekusinya membocorkan
 *    berapa banyak prefix yang sudah benar. Kedua sisi di-hash dulu supaya
 *    panjangnya sama, lalu dibandingkan dengan timingSafeEqual.
 *
 * 2. CRON_SECRET yang KOSONG berarti DITOLAK, bukan diterima. Kalau
 *    variabelnya lupa diisi saat deploy, endpoint internal harus tertutup
 *    rapat -- bukan terbuka untuk semua orang.
 */
export function verifyCronSecret(authHeader: string | null | undefined): boolean {
  const expected = (process.env.CRON_SECRET ?? '').trim();
  if (!expected) return false;
  if (!authHeader) return false;

  // Skema auth HTTP tidak peka huruf besar/kecil (RFC 7235), dan spasi di
  // sekitar token tidak pernah bermakna. Versi sebelumnya memakai
  // startsWith('Bearer ') + slice() mentah, sehingga satu spasi ekstra --
  // misalnya dari variabel klien REST yang tidak ter-trim -- ditolak
  // seolah secretnya salah. Kegagalan yang sangat membingungkan karena
  // pesannya identik dengan 'kamu memang tidak berwenang'.
  const m = /^\s*Bearer\s+(\S.*?)\s*$/i.exec(authHeader);
  if (!m) return false;

  const provided = m[1];

  const a = createHash('sha256').update(provided).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}
