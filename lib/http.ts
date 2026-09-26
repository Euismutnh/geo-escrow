/**
 * Amplop respons + penanganan error yang seragam untuk semua route.
 *
 * Sukses : { ok: true,  ...data }
 * Gagal  : { ok: false, error: "pesan", code: "SLUG" }
 */

import { NextResponse } from 'next/server';
import { OracleError } from './oracle/types';

export type ErrorCode =
  | 'VALIDATION'
  | 'HASH_MISMATCH'
  | 'NOT_FOUND'
  | 'WRONG_STATUS'
  | 'BUSY'
  | 'STRUCTURAL_FAILED'
  | 'RATE_LIMITED'
  | 'ORACLE_FAILED'
  | 'CHAIN_FAILED'
  | 'INTERNAL';

const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  HASH_MISMATCH: 400,
  NOT_FOUND: 404,
  WRONG_STATUS: 409,
  BUSY: 409,
  STRUCTURAL_FAILED: 422,
  RATE_LIMITED: 429,
  ORACLE_FAILED: 502,
  CHAIN_FAILED: 502,
  INTERNAL: 500,
};

export function ok<T extends object>(data: T): NextResponse {
  return NextResponse.json({ ok: true, ...data });
}

export function fail(code: ErrorCode, error: string): NextResponse {
  return NextResponse.json(
    { ok: false, code, error },
    { status: HTTP_STATUS[code] }
  );
}

/**
 * Error yang boleh dikirim apa adanya ke client.
 * Apa pun yang di-throw SELAIN ini dianggap bug internal dan
 * pesannya TIDAK diteruskan (lihat handler di bawah).
 */
export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    /** Error asli (Supabase, viem, SDK) — HANYA untuk log server, tidak pernah dikirim ke klien. */
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'ApiError';
  }
}

/**
 * Error dari infrastruktur (Supabase, viem, SDK) -> ApiError INTERNAL
 * dengan pesan UMUM. Error aslinya dicatat lengkap di log server.
 *
 * Jangan pernah `new ApiError('INTERNAL', error.message)`: pesan mentah
 * PostgREST membocorkan nama kolom & struktur tabel, dan pesan viem memuat
 * URL RPC LENGKAP dan isi request (diuji 2026-09-24) — termasuk kuncinya
 * begitu RPC memakai penyedia berbayar yang menaruh kunci di URL.
 * scripts/check-security.ts menolak pola itu.
 *
 *   if (error) throw internalError('memuat daftar job', error);
 */
export function internalError(context: string, cause: unknown): ApiError {
  console.error(`[internal] ${context}:`, cause);
  return new ApiError('INTERNAL', `Gagal ${context}`, { cause });
}

/**
 * Pesan yang AMAN untuk publik dari error apa pun — untuk respons API dan
 * untuk kolom `last_error` (yang terbaca siapa pun lewat GET /api/jobs/:id).
 *
 * Hanya pesan yang KITA tulis yang diteruskan: ApiError dan OracleError.
 * Selain itu diganti `fallback`, dan aslinya dicatat di log server.
 */
export function publicErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError || e instanceof OracleError) return e.message;
  console.error('[internal] pesan disembunyikan dari publik:', e);
  return fallback;
}

/**
 * Bungkus tiap handler route dengan ini.
 *
 * Gunanya dua: ApiError jadi respons rapi, dan error tak terduga
 * (stack trace, pesan mentah Postgres, isi env) tidak pernah bocor
 * ke client — hanya tercatat di log server.
 *
 * Pemakaian:
 *   export const GET = handler(async (req: NextRequest) => { ... });
 */
export function handler<A extends unknown[]>(
  fn: (...args: A) => Promise<NextResponse>
) {
  return async (...args: A): Promise<NextResponse> => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiError) return fail(e.code, e.message);
      console.error('[api] unhandled error:', e);
      return fail('INTERNAL', 'Terjadi kesalahan internal');
    }
  };
}
