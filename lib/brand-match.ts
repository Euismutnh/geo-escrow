/**
 * Pencocokan nama brand di teks jawaban AI.
 *
 * Modul MURNI — tanpa impor apa pun — supaya bisa dipakai server (Oracle,
 * structural check) DAN frontend (penanda brand di Log Oracle) tanpa
 * menyeret @anthropic-ai/sdk ke bundle browser. Dulu textHitsBrand tinggal
 * di lib/oracle/index.ts, yang mengimpor provider Claude; lib/oracle masih
 * me-re-export-nya, jadi impor lama tetap berfungsi.
 *
 * Kedua fungsi di bawah memakai SATU pembuat pola (brandRegex), supaya yang
 * disorot di layar tidak bisa berbeda dari yang dihitung "disebut".
 */

/**
 * Batas kata (\b) hanya dipasang di sisi yang berbatasan dengan karakter
 * kata. Rancangan awal selalu memasang \b di kedua sisi -- untuk brand yang
 * diawali atau diakhiri karakter non-kata (mis. "Acme!" atau "&Co"), \b
 * tidak akan pernah cocok, sehingga brand itu SELAMANYA dinilai tidak
 * disebut. Regex-nya tetap valid, jadi blok catch pun tidak menyelamatkan.
 *
 * @param b brand yang SUDAH di-trim dan tidak kosong
 * @returns null kalau pola tidak bisa dibentuk
 */
function brandRegex(b: string, flags: string): RegExp | null {
  const escaped = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const head = /\w/.test(b[0]) ? '\\b' : '';
  const tail = /\w/.test(b[b.length - 1]) ? '\\b' : '';
  try {
    return new RegExp(head + escaped + tail, flags);
  } catch {
    return null;
  }
}

/** Apakah teks menyebut brand? Port dari textHitsBrand() di prototipe. */
export function textHitsBrand(text: string, brand: string): boolean {
  if (!text || !brand) return false;

  const b = brand.trim();
  if (!b) return false;

  const re = brandRegex(b, 'i');
  return re ? re.test(text) : text.toLowerCase().includes(b.toLowerCase());
}

/**
 * Pecah teks jadi potongan, menandai setiap kemunculan brand — untuk
 * MENAMPILKAN saja (mis. <mark> di Log Oracle). Keputusan hit tetap milik
 * server (kolom run.hit); fungsi ini tidak pernah dipakai untuk menilai.
 */
export function splitByBrand(text: string, brand: string): { text: string; hit: boolean }[] {
  const b = (brand ?? '').trim();
  const re = text && b ? brandRegex(b, 'gi') : null;
  if (!re) return [{ text: text ?? '', hit: false }];

  const out: { text: string; hit: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), hit: false });
    out.push({ text: m[0], hit: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out;
}
