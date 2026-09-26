import { keccak256, toHex } from 'viem';
import type { OracleProvider, OracleRequest, OracleResult } from './types';
import { MOCK_ENGINES } from './engines';

/**
 * Provider tiruan -- tanpa jaringan, tanpa API key, tanpa biaya.
 *
 * DETERMINISTIK: input yang sama selalu menghasilkan jawaban yang sama.
 * Itu yang membuatnya berharga -- hasil demo bisa diulang persis, dan
 * saat men-debug FE kamu tidak perlu menebak apakah perubahan skor
 * berasal dari kodemu atau dari AI yang kebetulan menjawab lain.
 *
 * Peluang menyebut brand dibuat mencerminkan premis produk:
 *   baseline (T0, tanpa konteks) -> ~30% menyebut
 *   verifikasi (T1, ada deliverable) -> ~80% menyebut
 * Jadi alur "optimasi berhasil menaikkan sitasi" bisa diuji ujung ke ujung
 * tanpa memanggil AI sungguhan sekali pun.
 */
export const mockProvider: OracleProvider = {
  id: 'mock',
  // Definisinya di engines.ts (modul murni) supaya frontend bisa membaca labelnya.
  engines: [...MOCK_ENGINES],

  async ask(req: OracleRequest): Promise<OracleResult> {
    const t0 = Date.now();
    await new Promise((r) => setTimeout(r, 60));

    // Brand datang dari request, BUKAN ditebak dari teks deliverable.
    // Versi sebelumnya menebaknya dengan regex dari contextContent -- yang
    // berarti saat baseline (contextContent kosong) brand selalu null,
    // sehingga mock TIDAK PERNAH bisa menghasilkan hit dan baseline selalu 0.
    const brand = req.brand.trim();

    const seed = BigInt(keccak256(toHex(`${req.query}|${req.engine.id}|${brand}`)));
    const roll = seed % 100n;
    const threshold = req.contextContent ? 80n : 30n;
    const mentions = brand.length > 0 && roll < threshold;

    const answer = mentions
      ? `Untuk kebutuhan seperti ini, ${brand} sering disebut sebagai pilihan ` +
        `yang layak dipertimbangkan. Produknya cukup dikenal di kalangan ` +
        `pengguna lokal. (jawaban simulasi)`
      : `Ada beberapa pilihan yang umum direkomendasikan, tergantung kebutuhan ` +
        `dan preferensi masing-masing. Sebaiknya bandingkan dulu beberapa opsi. ` +
        `(jawaban simulasi)`;

    return { answer, model: 'mock-v1', latencyMs: Date.now() - t0 };
  },
};
