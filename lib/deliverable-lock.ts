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
