import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import { systemPrompt, userContent } from './prompt';
import { OracleError, type OracleProvider, type OracleRequest, type OracleResult } from './types';
import { CLAUDE_ENGINES } from './engines';

const MODEL = 'claude-opus-5';

/**
 * max_tokens harus memberi ruang untuk THINKING, bukan cuma jawaban.
 *
 * Pada Opus 5 adaptive thinking menyala secara default, dan token berpikir
 * ikut dihitung ke max_tokens. Dengan batas 1000 seperti rancangan awal,
 * jawaban 2-4 kalimat bisa terpotong di tengah -- dan jawaban terpotong
 * akan dinilai sebagai "brand tidak disebut" padahal belum selesai menjawab.
 * Itu kesalahan pengukuran yang sulit disadari.
 */
const MAX_TOKENS = 4096;
const TIMEOUT_MS = 30_000;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  client ??= new Anthropic({
    apiKey: env.anthropicKey,
    timeout: TIMEOUT_MS,
    // SDK sudah otomatis mengulang 408/409/429/5xx dan gangguan koneksi.
    maxRetries: 2,
  });
  return client;
}

export const claudeProvider: OracleProvider = {
  id: 'claude',

  // Dua PERSONA dari model yang sama, bukan dua mesin AI — lihat catatan
  // kejujuran di engines.ts, tempat definisinya sekarang tinggal (modul
  // murni, supaya frontend bisa membaca labelnya tanpa SDK ini).
  engines: [...CLAUDE_ENGINES],

  async ask(req: OracleRequest): Promise<OracleResult> {
    const t0 = Date.now();

    let res: Anthropic.Beta.BetaMessage;
    try {
      res = await getClient().beta.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // effort 'low': jawabannya pendek dan tidak butuh penalaran dalam.
        // Menurunkan biaya & latensi TANPA mematikan thinking -- mematikannya
        // pada Opus 5 berisiko membocorkan tag internal ke dalam jawaban.
        output_config: { effort: 'low' },
        // Refusal fallback (Fase 10): kalau model menolak, API menjalankan
        // ulang permintaan yang sama di model cadangan dalam SATU panggilan.
        // Model yang benar-benar menjawab dicatat dari res.model di bawah —
        // log Oracle tidak boleh mengaku jawabannya dari model lain.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: systemPrompt(req),
        // Deliverable = blok dokumen terpisah, BUKAN bagian system prompt
        // (pertahanan injeksi prompt, lihat lib/oracle/prompt.ts).
        messages: [{ role: 'user', content: userContent(req) }],
      });
    } catch (e) {
      throw toOracleError(e);
    }

    // stop_reason WAJIB dicek sebelum membaca isi. Jawaban terpotong atau
    // ditolak akan tampak seperti "brand tidak disebut" -- lebih baik gagal
    // terang-terangan daripada mencatat skor yang salah.
    if (res.stop_reason === 'max_tokens') {
      throw new OracleError('Jawaban terpotong (max_tokens)', true);
    }
    if (res.stop_reason === 'refusal') {
      throw new OracleError(
        `Permintaan ditolak model (${res.stop_details?.category ?? 'tanpa kategori'})`,
        false
      );
    }

    // res.content adalah union (termasuk blok fallback) -- persempit dulu
    // sebelum membaca .text.
    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (!text) throw new OracleError('Model mengembalikan jawaban kosong', true);

    return { answer: text, model: res.model, latencyMs: Date.now() - t0 };
  },
};

function toOracleError(e: unknown): OracleError {
  if (e instanceof Anthropic.RateLimitError) {
    return new OracleError('Kena rate limit Anthropic', true);
  }
  if (e instanceof Anthropic.AuthenticationError) {
    return new OracleError('ANTHROPIC_API_KEY ditolak', false);
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new OracleError('Gagal terhubung ke Anthropic (timeout/jaringan)', true);
  }
  if (e instanceof Anthropic.APIError) {
    return new OracleError(`Anthropic error ${e.status}`, (e.status ?? 0) >= 500);
  }
  // Error tak dikenal: pesan aslinya tidak diteruskan (OracleError dianggap
  // aman untuk publik oleh publicErrorMessage). Aslinya ke log server.
  console.error('[oracle] error tak dikenal dari Anthropic SDK:', e);
  return new OracleError('Kesalahan tak terduga saat menghubungi AI', false);
}
