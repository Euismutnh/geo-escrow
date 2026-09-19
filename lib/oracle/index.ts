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

/**
 * Apakah teks menyebut brand? Port dari textHitsBrand() di prototipe.
 *
 * Batas kata (\b) hanya dipasang di sisi yang berbatasan dengan karakter
 * kata. Rancangan awal selalu memasang \b di kedua sisi -- untuk brand yang
 * diawali atau diakhiri karakter non-kata (mis. "Acme!" atau "&Co"), \b
 * tidak akan pernah cocok, sehingga brand itu SELAMANYA dinilai tidak
 * disebut. Regex-nya tetap valid, jadi blok catch pun tidak menyelamatkan.
 */
export function textHitsBrand(text: string, brand: string): boolean {
  if (!text || !brand) return false;

  const b = brand.trim();
  if (!b) return false;

  const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = /\w/.test(b[0]) ? '\\b' : '';
  const tail = /\w/.test(b[b.length - 1]) ? '\\b' : '';

  try {
    return new RegExp(head + escaped + tail, 'i').test(text);
  } catch {
    return text.toLowerCase().includes(b.toLowerCase());
  }
}
