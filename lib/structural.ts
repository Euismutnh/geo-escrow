import { textHitsBrand } from './oracle';

/**
 * Panjang minimum deliverable.
 *
 * Angka 40 diambil persis dari prototipe. Gunanya bukan menilai mutu --
 * itu tugas Oracle di fase verifikasi -- melainkan menyaring kiriman yang
 * jelas-jelas bukan konten sungguhan ("ok", "sudah", spasi kosong)
 * SEBELUM freelancer membayar gas untuk transaksi submitDeliverable.
 */
export const MIN_DELIVERABLE_LENGTH = 40;

export type StructuralFailure = 'too_short' | 'brand_not_mentioned';

export interface StructuralResult {
  pass: boolean;
  reason?: StructuralFailure;
  message?: string;
}

/**
 * Structural check -- gerbang cepat sebelum verifikasi AI.
 *
 * Dua syarat, sama persis dengan prototipe:
 *   1. Panjang >= MIN_DELIVERABLE_LENGTH
 *   2. Menyebut nama brand secara eksplisit
 *
 * Syarat kedua bukan formalitas: isi deliverable dipakai sebagai KONTEKS
 * yang dibaca Oracle saat verifikasi. Kalau brandnya sendiri tidak
 * disebut di situ, verifikasi hampir pasti gagal -- dan kegagalan itu
 * baru ketahuan setelah panggilan AI dibayar. Lebih baik ditolak di sini,
 * gratis dan instan.
 *
 * Fungsi murni: tidak menyentuh database maupun jaringan, jadi bisa
 * diuji langsung (lihat scripts/check-input.ts).
 */
export function checkStructural(content: string, brand: string): StructuralResult {
  const text = content.trim();

  if (text.length < MIN_DELIVERABLE_LENGTH) {
    return {
      pass: false,
      reason: 'too_short',
      message: `Konten terlalu pendek (minimal ${MIN_DELIVERABLE_LENGTH} karakter, dikirim ${text.length})`,
    };
  }

  if (!textHitsBrand(text, brand)) {
    return {
      pass: false,
      reason: 'brand_not_mentioned',
      message: `Konten harus menyebut nama brand "${brand}" secara eksplisit`,
    };
  }

  return { pass: true };
}
