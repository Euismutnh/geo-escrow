/**
 * Rate limit sederhana berbasis memori.
 *
 * BATASNYA HARUS DIPAHAMI: di serverless, tiap instance punya Map
 * sendiri. Ini BUKAN jaminan global -- fungsinya meredam klik ganda dan
 * spam ringan dari satu klien, bukan menahan penyerang sungguhan.
 *
 * Lapisan pertahanan yang sebenarnya untuk pekerjaan Oracle adalah lock
 * atomik di database (acquireLock), yang berlaku lintas instance.
 */
const hits = new Map<string, number>();

/** true = boleh lanjut. false = terlalu cepat, tolak. */
export function rateLimit(key: string, windowMs: number): boolean {
  const now = Date.now();
  const last = hits.get(key) ?? 0;

  if (now - last < windowMs) return false;

  hits.set(key, now);

  // Cegah Map tumbuh tanpa batas di instance yang berumur panjang.
  if (hits.size > 1000) {
    for (const [k, t] of hits) {
      if (now - t > windowMs * 10) hits.delete(k);
    }
    if (hits.size > 1000) hits.clear();
  }

  return true;
}
