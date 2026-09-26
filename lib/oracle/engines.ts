import type { OracleEngine } from './types';

/**
 * Daftar engine tiap provider — modul MURNI (hanya impor tipe), supaya
 * frontend bisa menampilkan labelnya tanpa menyeret @anthropic-ai/sdk.
 * mock.ts dan claude.ts memakai array yang SAMA ini, jadi label di layar
 * dan di server tidak bisa berbeda.
 *
 * Kolom oracle_runs.engine menyimpan `id`, bukan `name`.
 */
export const MOCK_ENGINES: readonly OracleEngine[] = [
  { id: 'mock-a', name: 'Mock A', note: 'gaya ringkas & to-the-point' },
  { id: 'mock-b', name: 'Mock B', note: 'gaya naratif dengan konteks tambahan' },
];

// CATATAN KEJUJURAN: dua entri di bawah adalah dua PERSONA dari model
// yang SAMA, bukan dua mesin AI berbeda. Sejak Gemini dibatalkan
// (keputusan tim 2026-09-13), Claude adalah satu-satunya provider --
// jadi multi_engine TIDAK AKAN PERNAH berarti dua mesin AI.
//
// Nama engine sengaja TIDAK ditulis "Mesin A/B": nilai ini tampil di
// halaman Log Oracle, dan label "Mesin" akan membuat UI menyuarakan
// klaim yang tidak bisa kita pertanggungjawabkan di depan juri.
export const CLAUDE_ENGINES: readonly OracleEngine[] = [
  { id: 'claude-ringkas', name: 'Claude (ringkas)', note: 'gaya ringkas & to-the-point' },
  { id: 'claude-naratif', name: 'Claude (naratif)', note: 'gaya naratif dengan sedikit konteks tambahan' },
];

const LABELS = new Map([...MOCK_ENGINES, ...CLAUDE_ENGINES].map((e) => [e.id, e.name]));

/**
 * Label untuk id engine yang tersimpan di oracle_runs.engine.
 * Id yang tidak dikenal ditampilkan apa adanya — lebih jujur daripada
 * menebak nama untuk engine yang tidak kita ketahui.
 */
export function engineLabel(id: string): string {
  return LABELS.get(id) ?? id;
}
