import type { CSSProperties } from 'react';

export function Sk({ w = '100%', h = 14, style }: { w?: number | string; h?: number; style?: CSSProperties }) {
  return <i className="sk" aria-hidden="true" style={{ width: w, height: h, ...style }} />;
}

export function JobGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="jobs" aria-busy="true" aria-label="Memuat kontrak">
      {Array.from({ length: count }, (_, i) => (
        <div className="card job" key={i}>
          <div className="job-top">
            <div className="job-who"><Sk w={40} h={40} /><div><Sk w={28} h={11} style={{ marginBottom: 8 }} /><Sk w={140} h={16} /></div></div>
            <Sk w={84} h={22} style={{ borderRadius: 999 }} />
          </div>
          <div><Sk h={13} /><Sk w="70%" h={13} style={{ marginTop: 8 }} /></div>
          <Sk h={6} />
          <div className="job-foot"><Sk w={90} h={14} /></div>
        </div>
      ))}
    </div>
  );
}
