/**
 * Amplop respons + penanganan error yang seragam untuk semua route.
 *
 * Sukses : { ok: true,  ...data }
 * Gagal  : { ok: false, error: "pesan", code: "SLUG" }
 */

import { NextResponse } from 'next/server';

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
    message: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
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
