import { useSyncExternalStore } from 'react';

/**
 * Jam bersama untuk komponen yang menampilkan waktu relatif
 * ("5 menit lalu", "tutup dalam 2 hari").
 *
 * Kenapa bukan Date.now() langsung di render:
 *   - Render React harus murni; Date.now() memberi hasil berbeda tiap
 *     render (lint react-hooks/purity menolaknya).
 *   - Di server dan browser nilainya berbeda -> hydration mismatch.
 *
 * useSyncExternalStore memberi `null` di server DAN selama hydration
 * (getServerSnapshot), lalu nilai sungguhan setelahnya — jadi komponen
 * wajib menangani `null` (tampilkan cadangan). Satu interval untuk semua
 * pemakai; berhenti sendiri kalau tidak ada yang berlangganan.
 */
const TICK_MS = 30_000;

let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!timer) {
    // Segarkan saat pelanggan pertama datang: jam bisa sudah lama berhenti.
    // useSyncExternalStore memeriksa ulang snapshot setelah subscribe,
    // jadi perubahan ini langsung terbaca.
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, TICK_MS);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
      now = 0; // jangan simpan waktu basi untuk pemasangan berikutnya
    }
  };
}

const getSnapshot = () => (now === 0 ? null : now);
const getServerSnapshot = () => null;

/** Waktu sekarang (ms), atau `null` di server / selama hydration. */
export function useNow(): number | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
