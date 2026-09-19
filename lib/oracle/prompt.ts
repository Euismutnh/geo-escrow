import type { OracleRequest } from './types';

/**
 * System prompt -- port langsung dari callOracle() di prototipe HTML.
 *
 * JANGAN ubah tanpa alasan kuat: prompt ini sudah teruji, dan mengubahnya
 * membuat hasil baseline lama tidak sebanding dengan yang baru.
 *
 * Perhatikan `req.brand` sengaja TIDAK dipakai di sini. Menyebut brand
 * dalam prompt akan membuat AI cenderung menyebutnya di jawaban, sehingga
 * skor sitasi jadi palsu. Yang boleh masuk hanya query dan (saat
 * verifikasi) isi deliverable.
 */
export function systemPrompt(req: OracleRequest): string {
  const persona = ` Gaya kamu: ${req.engine.note}.`;
  const base =
    `Kamu mensimulasikan mesin jawaban AI publik (seperti Perplexity/Gemini) ` +
    `untuk demo hackathon.${persona}`;

  if (req.contextContent) {
    return (
      `${base} Kamu telah "mengindeks" konten publik berikut sebagai bagian ` +
      `dari pengetahuanmu:\n\n"""\n${req.contextContent}\n"""\n\n` +
      `Jawab pertanyaan pengguna berikutnya secara natural dalam Bahasa Indonesia, ` +
      `2-4 kalimat, gaya ringkas seperti jawaban mesin pencari AI. ` +
      `Sebutkan nama brand secara eksplisit hanya jika benar-benar relevan ` +
      `berdasarkan konteks di atas -- jangan menyebutnya kalau tidak relevan.`
    );
  }

  return (
    `${base} Jawab pertanyaan pengguna berikutnya secara natural dalam ` +
    `Bahasa Indonesia, 2-4 kalimat, gaya ringkas seperti jawaban mesin pencari AI, ` +
    `berdasarkan pengetahuan umum kamu saja.`
  );
}
