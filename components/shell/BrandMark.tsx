/** Logo GEO Escrow — radar dengan titik sinyal. Warna kotak diatur CSS per konteks (sidebar gelap / topbar terang). */
export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect width="28" height="28" rx="7.5" />
      <circle cx="14" cy="14" r="7.8" fill="none" stroke="#fff" strokeOpacity=".28" strokeWidth="1.5" />
      <circle cx="14" cy="14" r="3.6" fill="none" stroke="#fff" strokeWidth="1.7" />
      <path d="M14 14l5.5-5.5" stroke="#fff" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="19.6" cy="8.4" r="2.1" style={{ fill: 'var(--mark-dot)' }} />
    </svg>
  );
}
