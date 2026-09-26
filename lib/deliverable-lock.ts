/**
 * Kapan isi deliverable TERKUNCI — modul MURNI, dipakai
 * POST /api/jobs/:id/deliverable dan confirmStructural() (lib/flows/structural.ts).
 *
 * Aturannya: konten terkunci ke hash yang DITANDATANGANI freelancer di
 * kontrak (submitDeliverable), bukan ke kiriman pertama yang kebetulan
 * masuk ke database.
 *
 * Kenapa diubah (temuan Fase 7): dulu route menulis deliverable_hash ke
 * database pada kiriman PERTAMA — sebelum apa pun ada di chain — lalu
 * menolak kiriman berikutnya yang berbeda. Endpoint itu tidak
 * berautentikasi, jadi (1) freelancer tidak bisa merevisi drafnya sebelum
 * tanda tangan, dan (2) siapa pun yang mengirim duluan bisa "mengunci"
 * draf orang lain. Sebelum tanda tangan tidak ada yang perlu dilindungi:
 * yang mengikat adalah hash on-chain, dan hanya freelancer yang bisa
 * menaruhnya di sana ("GEO: bukan freelancer job ini").
 *
 * Saat CHAIN_ENABLED=false tidak ada chain untuk dijadikan jangkar, jadi
 * perilaku lama (kunci dari database) dipertahankan untuk mode pengembangan.
 */

const ZERO = /^0x0*$/;

/** bytes32 kosong = belum ada yang ditandatangani. */
export function isEmptyHash(h: string | null | undefined): boolean {
  return !h || ZERO.test(h);
}

/**
 * Hash yang WAJIB dicocoki konten, atau null kalau konten masih bebas direvisi.
 *
 * chainEnabled: hash on-chain (null/nol = belum ditandatangani = bebas).
 * chain mati  : hash di database (perilaku lama).
 */
export function lockedDeliverableHash(o: {
  chainEnabled: boolean;
  onChainHash: string | null | undefined;
  dbHash: string | null | undefined;
}): string | null {
  if (o.chainEnabled) return isEmptyHash(o.onChainHash) ? null : o.onChainHash!.toLowerCase();
  return isEmptyHash(o.dbHash) ? null : o.dbHash!.toLowerCase();
}

/** Konten boleh disimpan? (hash-nya cocok dengan yang terkunci, atau belum ada yang terkunci) */
export function contentAllowed(locked: string | null, contentHash: string): boolean {
  return locked === null || locked === contentHash.toLowerCase();
}

/**
 * `last_error` yang ditulis confirmStructural() saat isi di database ≠ hash
 * on-chain. Satu sumber: FE mencocokkan teks ini untuk membedakannya dari
 * gangguan sistem biasa (penyebab dan jalan keluarnya berbeda).
 */
export const HASH_MISMATCH_ERROR = 'Isi deliverable tidak cocok dengan hash on-chain';

/**
 * Berapa lama Oracle menunggu konten yang DITANDATANGANI sampai ke server
 * (atau dikirim ulang dengan isi yang persis sama) sebelum mengembalikan
 * kontrak ke tahap pengerjaan lewat rejectStructural (temuan audit S-22).
 * Tanpa batas ini, hash yang ditandatangani tanpa konten — tab ditutup,
 * draf hilang — menahan kontrak di Submitted sampai eskalasi 7 hari.
 * Bond freelancer tidak tersentuh; ia bisa langsung mengirim ulang.
 */
export const SIGNED_CONTENT_GRACE_MS = 2 * 60 * 60_000;

/** `submittedAtSec` = jobs().submittedAt (detik Unix, 0 = belum/di-reset). */
export function signedContentGraceExpired(submittedAtSec: bigint | number, nowMs: number): boolean {
  const s = Number(submittedAtSec);
  return s > 0 && nowMs - s * 1000 > SIGNED_CONTENT_GRACE_MS;
}

export const SIGNED_CONTENT_MISSING_REASON =
  'Konten yang ditandatangani tidak diterima server dalam 2 jam — kontrak dikembalikan ke tahap pengerjaan, silakan kirim ulang.';
