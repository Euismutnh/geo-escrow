import type { ErrorCode } from './http';

/**
 * Klien API untuk FRONTEND — satu-satunya tempat di FE yang tahu bentuk
 * amplop respons backend (lib/http.ts):
 *
 *   Sukses : { ok: true,  ...data }
 *   Gagal  : { ok: false, error: "pesan", code: "SLUG" }
 *
 * `import type` di atas dihapus saat kompilasi, jadi modul ini TIDAK
 * menarik next/server (NextResponse) ke bundle klien. Aman dipakai di
 * Server maupun Client Component.
 */

/** Kode dari backend, ditambah dua kode yang hanya bisa terjadi di sisi klien. */
export type ApiErrorCode = ErrorCode | 'NETWORK' | 'BAD_RESPONSE';

export class ApiClientError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    /** Status HTTP; 0 kalau permintaan tidak pernah sampai ke server. */
    public readonly status: number
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

type Envelope<T> = ({ ok: true } & T) | { ok: false; error: string; code: ErrorCode };

/**
 * Panggil endpoint dan kembalikan datanya tanpa field `ok`.
 * Melempar ApiClientError untuk semua kegagalan — termasuk jaringan putus
 * dan respons yang bukan amplop JSON (mis. halaman error proxy/CDN).
 *
 *   const { jobs } = await api<{ jobs: Job[] }>('/api/jobs?filter=open');
 */
export async function api<T extends object>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
    });
  } catch {
    throw new ApiClientError('NETWORK', 'Tidak bisa menghubungi server. Periksa koneksi Anda.', 0);
  }

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiClientError('BAD_RESPONSE', `Server membalas dengan format yang tidak dikenal (HTTP ${res.status}).`, res.status);
  }

  if (typeof body !== 'object' || body === null || typeof body.ok !== 'boolean') {
    throw new ApiClientError('BAD_RESPONSE', `Server membalas dengan format yang tidak dikenal (HTTP ${res.status}).`, res.status);
  }
  if (!body.ok) {
    throw new ApiClientError(body.code, body.error, res.status);
  }

  const data: Record<string, unknown> = { ...body };
  delete data.ok;
  return data as T;
}

/** POST dengan body JSON. */
export function apiPost<T extends object>(path: string, payload?: unknown): Promise<T> {
  return api<T>(path, { method: 'POST', body: payload === undefined ? undefined : JSON.stringify(payload) });
}
