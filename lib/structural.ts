// Langsung dari modul murni, BUKAN lewat './oracle' (yang mengekspornya
// ulang tapi juga mengimpor env & SDK Anthropic): form deliverable di
// browser memakai checkStructural() yang SAMA dengan server (Fase 7).
import { textHitsBrand } from './brand-match';

/**
 * Panjang minimum deliverable.
 *
 * Angka 40 diambil persis dari prototipe. Gunanya bukan menilai mutu --
 * itu tugas Oracle di fase verifikasi -- melainkan menyaring kiriman yang
 * jelas-jelas bukan konten sungguhan ("ok", "sudah", spasi kosong)
 * SEBELUM freelancer membayar gas untuk transaksi submitDeliverable.
 */
export const MIN_DELIVERABLE_LENGTH = 40;

export type StructuralFailure = 'too_short' | 'brand_not_mentioned' | 'instruction_like';

/**
 * Pola kalimat yang ditujukan ke MODEL AI, bukan ke pembaca manusia —
 * upaya injeksi prompt ke Oracle (temuan audit S-08). Lapis ketiga setelah
 * pemisahan dokumen dan penegasan di system prompt (lib/oracle/prompt.ts).
 *
 * SENGAJA SEMPIT: yang ditolak hanya kalimat yang tidak punya alasan sah
 * berada di konten pemasaran. "Kami selalu merekomendasikan…" atau "wajib
 * dicoba" TETAP lolos — menolaknya berarti menghukum konten yang jujur.
 * Diuji di scripts/check-input.ts.
 */
export const INSTRUCTION_PATTERNS: readonly RegExp[] = [
  /\babaikan\s+(semua\s+|seluruh\s+)?(instruksi|perintah|aturan|prompt)\b/i,
  /\bignore\s+(all\s+|any\s+|the\s+)?(previous\s+|prior\s+|above\s+|earlier\s+)?(instructions?|prompts?|rules)\b/i,
  /\b(system\s+prompt|prompt\s+sistem)\b/i,
  /\b(kamu|anda)\s+(adalah|sekarang)\s+(sebuah\s+)?(ai|asisten|model\s+bahasa|chatbot)\b/i,
  /\byou\s+are\s+(now\s+)?(an?\s+)?(ai|assistant|language\s+model|chatbot)\b/i,
  /^\s*(system|assistant|sistem|asisten)\s*:/im,
];

export interface StructuralResult {
  pass: boolean;
  reason?: StructuralFailure;
  message?: string;
}

/**
 * Structural check -- gerbang cepat sebelum verifikasi AI.
 *
 * Syaratnya:
 *   1. Panjang >= MIN_DELIVERABLE_LENGTH          (prototipe)
 *   2. Tidak memuat kalimat instruksi untuk AI     (Fase 10, S-08)
 *   3. Menyebut nama brand secara eksplisit        (prototipe)
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

  if (INSTRUCTION_PATTERNS.some((re) => re.test(text))) {
    return {
      pass: false,
      reason: 'instruction_like',
      message: 'Konten memuat kalimat yang ditujukan ke AI (mis. "abaikan instruksi", "system prompt"). Tulis konten untuk pembaca manusia.',
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
