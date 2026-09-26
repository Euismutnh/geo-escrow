import { env } from '../env';
import { mockProvider } from './mock';
import { claudeProvider } from './claude';
import { OracleError, type OracleProvider, type OracleEngine } from './types';

export * from './types';
export { systemPrompt } from './prompt';

/**
 * Hanya Claude -- keputusan tim (2026-09-13): tidak jadi memakai dua
 * provider AI (sempat direncanakan Claude + Gemini). Konsekuensinya:
 * `multi_engine` SELALU berarti dua persona dari model yang sama, bukan
 * dua penyedia berbeda. Kalau job punya multi_engine=true, sebut ke juri
 * sebagai "dua gaya penjawab", bukan "lolos di >=2 mesin AI" -- klaim
 * itu tidak akan pernah jujur dengan konfigurasi ini.
 */
const PROVIDERS: Record<string, OracleProvider> = {
  mock: mockProvider,
  claude: claudeProvider,
};

export function provider(): OracleProvider {
  return PROVIDERS[env.oracleProvider] ?? mockProvider;
}

/**
 * Engine yang dipakai untuk satu job.
 *
 * `p` bisa disuntik manual untuk pengujian (lihat check-oracle.ts) --
 * di produksi selalu dipanggil tanpa argumen kedua, jatuh ke provider()
 * yang aktif lewat ORACLE_PROVIDER.
 *
 * Sengaja MELEMPAR ERROR kalau multi_engine diminta tapi providernya
 * cuma punya satu engine. slice(0, 2) polos akan diam-diam mengembalikan
 * satu engine saja -- job tercatat multi_engine padahal hanya diukur
 * sekali, dan verdict-nya membohongi pembacanya. Lebih baik gagal
 * terang-terangan. (Tidak tersentuh oleh provider bawaan sekarang --
 * mock dan claude sama-sama punya 2 engine -- tapi tetap dijaga untuk
 * provider yang mungkin ditambah nanti.)
 */
export function enginesFor(
  multiEngine: boolean,
  p: OracleProvider = provider()
): OracleEngine[] {
  if (!multiEngine) return p.engines.slice(0, 1);

  if (p.engines.length < 2) {
    throw new OracleError(
      `Provider "${p.id}" hanya punya 1 engine, tidak bisa memenuhi multi_engine. ` +
        `Pakai provider lain, atau matikan multi_engine pada job ini.`,
      false
    );
  }
  return p.engines.slice(0, 2);
}

// Dipindah ke modul murni lib/brand-match.ts supaya frontend bisa memakainya
// tanpa menyeret provider Claude (@anthropic-ai/sdk). Re-export ini menjaga
// semua impor lama (runner.ts, structural.ts, check-oracle.ts) tetap sama.
export { textHitsBrand } from '../brand-match';
