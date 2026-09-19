import Anthropic from '@anthropic-ai/sdk';
import { env } from '../env';
import { systemPrompt } from './prompt';
import { OracleError, type OracleProvider, type OracleRequest, type OracleResult } from './types';

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

  // CATATAN KEJUJURAN: dua entri di bawah adalah dua PERSONA dari model
  // yang SAMA, bukan dua mesin AI berbeda. Sejak Gemini dibatalkan
  // (keputusan tim 2026-09-13), Claude adalah satu-satunya provider --
  // jadi multi_engine TIDAK AKAN PERNAH berarti dua mesin AI.
  //
  // Nama engine sengaja TIDAK ditulis "Mesin A/B": nilai ini tampil di
  // halaman Log Oracle, dan label "Mesin" akan membuat UI menyuarakan
  // klaim yang tidak bisa kita pertanggungjawabkan di depan juri.
  engines: [
    { id: 'claude-ringkas', name: 'Claude (ringkas)', note: 'gaya ringkas & to-the-point' },
    { id: 'claude-naratif', name: 'Claude (naratif)', note: 'gaya naratif dengan sedikit konteks tambahan' },
  ],

  async ask(req: OracleRequest): Promise<OracleResult> {
    const t0 = Date.now();

    let res: Anthropic.Message;
    try {
      res = await getClient().messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        // effort 'low': jawabannya pendek dan tidak butuh penalaran dalam.
        // Menurunkan biaya & latensi TANPA mematikan thinking -- mematikannya
        // pada Opus 5 berisiko membocorkan tag internal ke dalam jawaban.
        output_config: { effort: 'low' },
        system: systemPrompt(req),
        messages: [{ role: 'user', content: req.query }],
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

    // res.content adalah union -- persempit dulu sebelum membaca .text.
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
      .trim();

    if (!text) throw new OracleError('Model mengembalikan jawaban kosong', true);

    return { answer: text, model: MODEL, latencyMs: Date.now() - t0 };
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
  return new OracleError(e instanceof Error ? e.message : 'Oracle gagal', false);
}
