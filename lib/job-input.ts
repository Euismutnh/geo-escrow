import { parseEther } from 'viem';

/*
 * Aturan isian "Buat kontrak" — modul MURNI, dipakai backend
 * (lib/validate-input.ts mengimpor LIMITS dari sini) DAN form di browser.
 *
 * Kenapa bukan langsung mengimpor lib/validate-input.ts di FE: modul itu
 * melempar ApiError dari lib/http.ts, yang mengimpor next/server — kode
 * server ikut ter-bundle ke browser. Batasnya dipindah ke sini supaya
 * tetap SATU sumber; aturannya dicerminkan, tidak digantikan: backend tetap
 * otoritas (blueprint Fase 6).
 */

/** Batas panjang teks dari user. Alasannya di lib/validate-input.ts. */
export const LIMITS = {
  brand: 100,
  brief: 1_000,
  query: 300,
  deliverable: 20_000,
} as const;

/**
 * Budget minimum: 0,0005 tBNB (temuan audit S-09). Kontrak menerima 1 wei,
 * dan tiap kontrak memicu sampai 12 panggilan AI (baseline + verifikasi,
 * dua persona) — kontrak berharga nol akan menjadi cara murah menguras
 * kredit AI. Server menegakkan angka yang SAMA sebelum memanggil AI
 * sungguhan (lib/oracle/runner.ts), untuk kontrak yang dibuat di luar
 * aplikasi.
 */
export const MIN_BUDGET_WEI = 500_000_000_000_000n;

/** requireQueryPool(): 3–6 pertanyaan. */
export const QUERY_MIN = 3;
export const QUERY_MAX = 6;

/**
 * Batas ambil minimal 1 jam dari SEKARANG (§A7). Backend memeriksa "harus
 * di masa depan" saat POST — yang terjadi SETELAH transaksi terkonfirmasi.
 * Deadline yang terlalu dekat bisa lewat di antara keduanya: job ada di
 * chain, ditolak database → job yatim.
 */
export const MIN_LEAD_MS = 60 * 60 * 1000;

/** Satu pertanyaan per baris. \r (tempelan dari Windows) dibuang — ia mengubah hash. */
export function parseQueries(text: string): string[] {
  return text.split(/\r?\n/).map((q) => q.replace(/\r/g, '').trim()).filter(Boolean);
}

/**
 * "0,003" / "0.003" → wei (BigInt). null kalau bukan angka tBNB yang sah.
 * Koma diterima karena itu pemisah desimal Indonesia. Maksimal 18 desimal
 * (satuan wei). Tanpa Number(): parseEther memakai string.
 */
export function parseBudgetTbnb(raw: string): bigint | null {
  const t = raw.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,18})?$/.test(t)) return null;
  try { return parseEther(t); } catch { return null; }
}

export interface Draft {
  brand: string;
  brief: string;
  queries: string;
  target: string;
  budget: string;
  /** Nilai <input type="datetime-local">: "YYYY-MM-DDTHH:mm", waktu LOKAL. */
  deadline: string;
  multiEngine: boolean;
}

export type DraftField = 'brand' | 'brief' | 'queries' | 'target' | 'budget' | 'deadline';

/** Urutan kolom SEPERTI DI LAYAR — dipakai untuk menunjuk kesalahan pertama. */
export const FIELD_ORDER: readonly DraftField[] = ['brand', 'brief', 'queries', 'target', 'budget', 'deadline'];

export const FIELD_LABEL: Record<DraftField, string> = {
  brand: 'Nama brand',
  brief: 'Ringkasan brief',
  queries: 'Pertanyaan',
  target: 'Target',
  budget: 'Budget',
  deadline: 'Batas ambil',
};

/**
 * Kesalahan pertama menurut urutan di layar (bukan urutan pemeriksaan),
 * plus berapa kolom lain yang juga salah. Pesan di bawah tombol memakai
 * ini supaya menyebut KOLOMNYA — dulu hanya isi pesannya, dan kolomnya
 * baru ditandai kalau pernah disentuh, jadi tidak ketahuan mana yang salah.
 */
export function firstInvalid(errors: Partial<Record<DraftField, string>>): { field: DraftField; message: string; others: number } | null {
  const bad = FIELD_ORDER.filter((f) => errors[f]);
  if (bad.length === 0) return null;
  return { field: bad[0], message: errors[bad[0]]!, others: bad.length - 1 };
}

export interface DraftCheck {
  errors: Partial<Record<DraftField, string>>;
  brand: string;
  brief: string | null;
  queries: string[];
  targetCount: number;
  budgetWei: bigint | null;
  deadline: Date | null;
}

/**
 * Cermin lib/validate-input.ts (requireText, optionalText, requireQueryPool,
 * requireWei, requireFutureDate) + dua aturan yang hanya bisa dicek di
 * browser: baris baru di nama brand (hash kanonik memakai \n sebagai
 * pemisah — backend akan gagal 500, bukan 400) dan saldo wallet.
 */
export function checkDraft(d: Draft, now: number, balanceWei?: bigint | null): DraftCheck {
  const errors: DraftCheck['errors'] = {};
  const brand = d.brand.trim();
  const briefT = d.brief.trim();
  const queries = parseQueries(d.queries);

  if (!brand) errors.brand = 'Nama brand wajib diisi.';
  else if (brand.length > LIMITS.brand) errors.brand = `Maksimal ${LIMITS.brand} karakter (sekarang ${brand.length}).`;
  else if (/[\r\n]/.test(brand)) errors.brand = 'Nama brand tidak boleh mengandung baris baru.';

  if (briefT.length > LIMITS.brief) errors.brief = `Maksimal ${LIMITS.brief.toLocaleString('id-ID')} karakter (sekarang ${briefT.length.toLocaleString('id-ID')}).`;

  if (queries.length < QUERY_MIN) errors.queries = `Minimal ${QUERY_MIN} pertanyaan — baru ${queries.length}.`;
  else if (queries.length > QUERY_MAX) errors.queries = `Maksimal ${QUERY_MAX} pertanyaan — ada ${queries.length}.`;
  else if (new Set(queries.map((q) => q.toLowerCase())).size !== queries.length) errors.queries = 'Ada pertanyaan yang kembar. Pertanyaan kembar membayar AI dua kali untuk informasi yang sama.';
  else {
    const long = queries.findIndex((q) => q.length > LIMITS.query);
    if (long >= 0) errors.queries = `Pertanyaan #${long + 1} maksimal ${LIMITS.query} karakter (sekarang ${queries[long].length}).`;
  }

  const maxT = Math.max(Math.min(queries.length, QUERY_MAX), 1);
  const t = /^\d+$/.test(d.target.trim()) ? Number(d.target.trim()) : NaN;
  if (!Number.isInteger(t) || t < 1 || t > maxT) errors.target = `Bilangan bulat 1–${maxT}.`;

  const budgetWei = parseBudgetTbnb(d.budget);
  if (budgetWei === null || budgetWei <= 0n) errors.budget = 'Masukkan jumlah tBNB yang valid, mis. 0,003.';
  else if (budgetWei < MIN_BUDGET_WEI) errors.budget = 'Budget minimum 0,0005 tBNB.';
  else if (balanceWei !== undefined && balanceWei !== null && budgetWei >= balanceWei) errors.budget = 'Saldo wallet tidak cukup untuk budget ini ditambah biaya gas.';

  const ms = d.deadline ? Date.parse(d.deadline) : NaN;
  let deadline: Date | null = null;
  if (Number.isNaN(ms)) errors.deadline = 'Pilih tanggal dan jam.';
  else if (ms < now + MIN_LEAD_MS) errors.deadline = 'Minimal 1 jam dari sekarang. Server memeriksa ulang saat data disimpan, yaitu setelah transaksi terkonfirmasi.';
  else deadline = new Date(ms);

  return { errors, brand, brief: briefT || null, queries, targetCount: t, budgetWei, deadline };
}

/** <input type="datetime-local"> butuh waktu lokal tanpa zona: "YYYY-MM-DDTHH:mm". */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

/** uint64 detik untuk createJob — dari Date yang SAMA dengan body POST (§A7). */
export const toUnixSeconds = (d: Date) => BigInt(Math.floor(d.getTime() / 1000));

export const EXAMPLE_DRAFT: Omit<Draft, 'deadline'> = {
  brand: 'Senja Botanica',
  brief: 'Lilin aromaterapi dari bahan soy wax dan minyak atsiri lokal, dibuat di Ubud.',
  queries: [
    'Lilin aromaterapi lokal yang bagus?',
    'Rekomendasi lilin soy wax buatan Indonesia?',
    'Hadiah lilin aromaterapi untuk teman?',
    'Aromaterapi untuk membantu tidur, merek apa yang aman?',
    'Brand home fragrance dari Bali yang layak dicoba?',
  ].join('\n'),
  target: '3',
  budget: '0,003',
  multiEngine: false,
};
