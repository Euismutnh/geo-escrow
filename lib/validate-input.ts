import { ApiError } from './http';
import { LIMITS, QUERY_MAX, QUERY_MIN } from './job-input';

/**
 * Batas panjang untuk teks yang datang dari user — didefinisikan di
 * lib/job-input.ts (modul murni) supaya form di browser memakai angka yang
 * SAMA tanpa ikut menyeret lib/http.ts (next/server) ke bundle klien.
 * Diekspor ulang di sini; pengimpor lama tidak perlu berubah.
 *
 * Bukan sekadar kerapian. Tiga alasan konkret:
 *
 * 1. BIAYA — `queries` dikirim ke AI. Satu pertanyaan 50.000 karakter
 *    berarti satu panggilan AI yang sangat mahal, dan itu dikalikan
 *    jumlah engine. Tanpa batas, siapa pun bisa menentukan berapa besar
 *    tagihan kita.
 * 2. WAKTU — teks panjang memperlambat tiap panggilan, dan baseline
 *    punya anggaran 60 detik (maxDuration).
 * 3. PENYIMPANAN — kolom `text` di Postgres tidak punya batas bawaan.
 */
export { LIMITS };

/** Teks wajib, sudah di-trim, dengan batas panjang. */
export function requireText(
  raw: unknown,
  field: string,
  maxLength: number,
  { minLength = 1 }: { minLength?: number } = {}
): string {
  if (typeof raw !== 'string') {
    throw new ApiError('VALIDATION', `${field} wajib berupa teks`);
  }
  const v = raw.trim();
  if (v.length < minLength) {
    throw new ApiError('VALIDATION', `${field} wajib diisi`);
  }
  if (v.length > maxLength) {
    throw new ApiError(
      'VALIDATION',
      `${field} maksimal ${maxLength} karakter (dikirim ${v.length})`
    );
  }
  return v;
}

/** Teks opsional. null kalau kosong/absen. */
export function optionalText(
  raw: unknown,
  field: string,
  maxLength: number
): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  return requireText(raw, field, maxLength);
}

/**
 * Angka wei dari body request.
 *
 * Wajib STRING, bukan number: di atas 2^53 (~0,009 tBNB) JavaScript
 * kehilangan presisi, dan nilai yang sudah rusak saat masuk tidak bisa
 * diperbaiki lagi di belakang.
 */
export function requireWei(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !/^[0-9]+$/.test(raw)) {
    throw new ApiError(
      'VALIDATION',
      `${field} harus berupa string angka dalam satuan wei (bukan number)`
    );
  }
  if (raw.length > 40) {
    throw new ApiError('VALIDATION', `${field} tidak masuk akal besarnya`);
  }
  if (BigInt(raw) <= 0n) {
    throw new ApiError('VALIDATION', `${field} harus lebih besar dari 0`);
  }
  return raw;
}

/** job_id: bilangan bulat aman dan non-negatif. */
export function requireJobId(raw: unknown): number {
  // Number.isSafeInteger menolak 1.5, Infinity, NaN, dan angka di atas
  // 2^53 sekaligus -- `typeof raw === 'number' && raw >= 0` tidak.
  if (!Number.isSafeInteger(raw) || (raw as number) < 0) {
    throw new ApiError('VALIDATION', 'jobId harus bilangan bulat non-negatif');
  }
  return raw as number;
}

/**
 * Tanggal ISO opsional yang harus berada di masa depan.
 *
 * Tanpa pemeriksaan ini, nilai sembarang langsung masuk ke kolom
 * `timestamptz` dan Postgres yang menolaknya -- muncul sebagai error 500
 * yang membingungkan, bukan 400 yang menjelaskan.
 */
export function requireFutureDate(raw: unknown, field: string): string {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ApiError('VALIDATION', `${field} wajib diisi`);
  }
  const t = Date.parse(raw);
  if (Number.isNaN(t)) {
    throw new ApiError('VALIDATION', `${field} bukan tanggal yang valid`);
  }
  if (t <= Date.now()) {
    throw new ApiError('VALIDATION', `${field} harus di masa depan`);
  }
  return new Date(t).toISOString();
}

export interface QueryPoolCheck {
  queries: string[];
  targetCount: number;
}

/**
 * Validasi daftar pertanyaan + target.
 *
 * Pertanyaan kembar ditolak: hash tetap sah, tapi pengukurannya jadi
 * lemah (satu pertanyaan dihitung dua kali) DAN membayar panggilan AI
 * dua kali untuk informasi yang sama.
 */
export function requireQueryPool(
  rawQueries: unknown,
  rawTarget: unknown
): QueryPoolCheck {
  if (!Array.isArray(rawQueries)) {
    throw new ApiError('VALIDATION', 'queries harus berupa array');
  }
  if (rawQueries.length < QUERY_MIN || rawQueries.length > QUERY_MAX) {
    throw new ApiError('VALIDATION', `Jumlah pertanyaan harus ${QUERY_MIN}-${QUERY_MAX}`);
  }

  const queries = rawQueries.map((q, i) =>
    requireText(q, `Pertanyaan #${i + 1}`, LIMITS.query)
  );

  const seen = new Set(queries.map((q) => q.toLowerCase()));
  if (seen.size !== queries.length) {
    throw new ApiError('VALIDATION', 'Ada pertanyaan yang kembar');
  }

  if (!Number.isInteger(rawTarget)) {
    throw new ApiError('VALIDATION', 'targetCount harus bilangan bulat');
  }
  const targetCount = rawTarget as number;
  if (targetCount < 1 || targetCount > queries.length) {
    throw new ApiError(
      'VALIDATION',
      `Target harus antara 1 dan ${queries.length}`
    );
  }

  return { queries, targetCount };
}
