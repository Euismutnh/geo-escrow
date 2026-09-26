import type { ReactNode } from 'react';
import { Icon } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import type { ChainInfo } from '@/lib/chain-server';
import { addrUrl, isTxHash, shortHash, txUrl } from '@/lib/explorer';
import { formatRelative, formatTime, shortAddr } from '@/lib/format';
import {
  fundsLabel, heldInContract, isAcceptExpired, isHashMismatch, isVerifyStuck, oracleOffer, phaseHits, rejectedSubmission,
  type PhaseHits, type Step, type TimeCtx,
} from '@/lib/job-view';
import type { UiStatus } from '@/lib/status';
import type { ActivityEntry, Job, OracleRun } from '@/lib/types';
import { decide } from '@/lib/scoring';
import { subsetSize } from '@/lib/vrf';
import type { Relation } from '@/lib/tx';
import { AcceptCard, ArbiterDecision, DeliverableCard, EscalateAction, ReclaimAction } from './Actions';
import { OracleActionButton, ResendSignedContent } from './OracleActions';

/*
 * Kartu-kartu halaman detail (/jobs/[id]) — BACA SAJA di Fase 4. Tombol
 * aksi (ukur ulang, verifikasi, ambil, putus juri, tarik dana, eskalasi)
 * datang di Fase 5–8 bersama <TxButton>; di sini hanya keadaannya.
 *
 * Tanpa hook: data & jam (`now`) masuk lewat props dari JobDetailView,
 * supaya semua cabang tampilan bisa dibaca dari satu tempat.
 */

function Card({ title, meta, children, className }: { title: string; meta?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `card ${className}` : 'card'}>
      <div className="card-h"><h3>{title}</h3>{meta}</div>
      {children}
    </section>
  );
}

function TxLink({ hash }: { hash: string }) {
  return (
    <a className="txl" href={txUrl(hash)} target="_blank" rel="noopener noreferrer" title={hash}>
      {shortHash(hash)}<Icon name="ext" />
    </a>
  );
}

function Tech({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <details className="tech">
      <summary>Detail teknis</summary>
      <div className="err-line">{error}</div>
    </details>
  );
}

// ---------------------------------------------------------------------

export function TimelineCard({ steps, reached }: { steps: Step[]; reached: number }) {
  return (
    <Card title="Perjalanan kontrak" meta={<span className="meta num">{reached} dari 7 langkah</span>}>
      <ol className="tl">
        {steps.map((s) => (
          <li key={s.key} className={s.state === 'todo' ? undefined : s.state}>
            <span className="tl-dot">
              {s.state === 'done' && <Icon name="check" />}
              {s.state === 'fail' && <Icon name="x" />}
            </span>
            <div>
              <div className="tl-t">{s.title}</div>
              <div className="tl-s">{s.sub}</div>
            </div>
            <div className="tl-m">
              {s.at && <>{formatTime(s.at)}<br /></>}
              {s.state === 'done' && (isTxHash(s.tx) ? <TxLink hash={s.tx} /> : !s.chain && <span>oleh Oracle</span>)}
            </div>
          </li>
        ))}
      </ol>
    </Card>
  );
}

// ---------------------------------------------------------------------

function HitChip({ label, v }: { label: string; v: boolean | undefined | 'skip' }) {
  if (v === 'skip') return <span className="hit s" title="Tidak terpilih di subset verifikasi">{label} —</span>;
  if (v === undefined) return <span className="hit p" title="Belum diukur">{label}</span>;
  return (
    <span className={`hit ${v ? 'y' : 'n'}`} title={v ? 'Menyebut brand' : 'Tidak menyebut brand'}>
      {label}<Icon name={v ? 'check' : 'x'} />
    </span>
  );
}

/** Kalimat untuk log yang belum bisa dibaca sebagai hasil per pertanyaan. */
export function hitsProblem(p: PhaseHits): string | null {
  if (p.problem === 'waiting') return `Baru ${p.engines.length} dari ${p.expected} gaya penjawab yang menjawab — hasil per pertanyaan belum final.`;
  if (p.problem === 'ambiguous') return 'Log memuat lebih banyak gaya penjawab daripada yang dipakai kontrak ini, jadi hasil per pertanyaan tidak ditampilkan.';
  return null;
}

export function QueryPoolCard({ job, runs }: { job: Job; runs: OracleRun[] }) {
  const b = phaseHits(job, runs, 'baseline');
  const v = phaseHits(job, runs, 'verification');
  const sub = job.verification_subset;
  const problem = hitsProblem(b) ?? (sub ? hitsProblem(v) : null);

  return (
    <Card title="Query pool" meta={<span className="meta num">{job.queries.length} pertanyaan · target {job.target_count}</span>}>
      <ol className="qp">
        {job.queries.map((q, i) => (
          <li key={i}>
            <span className="qp-i">#{i + 1}</span>
            <span className="qp-q">{q}</span>
            <span className="qp-f">
              <HitChip label="T0" v={b.hits.get(i)} />
              {sub && <HitChip label="T1" v={sub.includes(i) ? v.hits.get(i) : 'skip'} />}
            </span>
          </li>
        ))}
      </ol>
      <div className="card-f">
        <div className="legend">
          <span><i className="lg lg-y" />Menyebut brand</span>
          <span><i className="lg lg-n" />Tidak menyebut</span>
          <span><i className="lg lg-p" />Belum diukur</span>
          <span><span className="mono">T0</span>baseline</span>
          <span><span className="mono">T1</span>verifikasi</span>
        </div>
        {job.multi_engine && <span className="f-note"><Icon name="info" className="i-xs" />Dihitung menyebut hanya jika <b>kedua</b> gaya penjawab menyebut.</span>}
        {problem && <span className="muted">{problem}</span>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------

function DelivBox({ job }: { job: Job }) {
  if (!job.deliverable_content) return null;
  return (
    <div className="deliv">
      <div className="deliv-h">
        <span><b>Konten terkirim</b>{job.deliverable_submitted_at && <> · {formatTime(job.deliverable_submitted_at)}</>}</span>
        {job.deliverable_hash && <span className="mono" title={job.deliverable_hash}><Icon name="hash" className="i-xs" />{shortHash(job.deliverable_hash)}</span>}
      </div>
      <div className="deliv-b">{job.deliverable_content}</div>
    </div>
  );
}

function Progress({ done, total, children }: { done: number; total: number; children: ReactNode }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="note note-info">
      <span className="spin" aria-hidden="true" />
      <div>
        {children}
        <div className="prog" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}><span style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}

export function WorkCard({ job, ui, runs, activity, time, rel, chain }: {
  job: Job; ui: UiStatus; runs: OracleRun[]; activity: ActivityEntry[]; time: TimeCtx;
  /** Peran wallet aktif di kontrak ini (Fase 7: siapa melihat tombol apa). */
  rel: Relation; chain: ChainInfo | undefined;
}) {
  const n = job.queries.length;
  const body = (title: string, children: ReactNode) => <Card title={title}><div className="card-b stack">{children}</div></Card>;
  // Tombol yang memicu kerja Oracle (verifikasi / konfirmasi ulang / ukur ulang) — atau null.
  const offer = oracleOffer(job, ui, time.now);
  const action = offer && (
    <>
      {offer.why && <div className="note note-warn"><Icon name="clock" /><div><b>{offer.why}</b> Dana tetap aman di kontrak.</div></div>}
      <OracleActionButton jobId={job.job_id} offer={offer} rel={rel} primary={ui === 'awaiting_verify'} />
    </>
  );
  // Macet melewati verifyTimeout sejak hasil dikirim (syarat kontrak escalateStuckJob).
  const stuck = isVerifyStuck(job, time);
  const escalation = stuck && (
    <>
      <div className="note note-warn">
        <Icon name="clock" />
        <div><b>Kontrak ini macet melewati batas waktu verifikasi.</b> Siapa pun boleh meneruskannya ke arbiter agar dana tidak tertahan — dana tetap di kontrak sampai arbiter memutus.</div>
      </div>
      <EscalateAction job={job} stuck={stuck} />
    </>
  );

  switch (ui) {
    case 'baseline_running': {
      const done = phaseHits(job, runs, 'baseline').hits.size;
      return body('Baseline', (
        <>
          <Progress done={done} total={n}>
            <b>Oracle sedang mengukur baseline — {done} dari {n} pertanyaan.</b> Kontrak bisa diambil freelancer setelah baseline selesai.
          </Progress>
          {action}
        </>
      ));
    }
    case 'baseline_failed':
      return body('Baseline', (
        <>
          <div className="note note-err">
            <Icon name="alert" />
            <div>
              <b>Baseline gagal diukur.</b> Dana tetap aman di kontrak. Pengukuran bisa diulang — pertanyaan yang sudah terjawab tidak dibayar dua kali.
              <Tech error={job.last_error} />
            </div>
          </div>
          {action}
        </>
      ));
    case 'open': {
      if (isAcceptExpired(job, time.now)) {
        return body('Menunggu freelancer', (
          <>
            <div className="note note-plain">
              <Icon name="clock" />
              <div><b>Batas ambil lewat {formatRelative(job.accept_deadline!, time.now!)}.</b> Kontrak ini tidak bisa diambil lagi, dan client bisa menarik kembali seluruh budget.</div>
            </div>
            <ReclaimAction job={job} rel={rel} now={time.now} />
          </>
        ));
      }
      // Siapa pun selain client melihat tawaran mengambil; penjaganya di AcceptCard.
      if (rel !== 'client') return <AcceptCard job={job} ui={ui} chain={chain} now={time.now} />;
      return body('Menunggu freelancer', (
        <div className="who">
          <Icon name="users" />
          <span>
            Belum ada yang mengambil.
            {job.accept_deadline && <> Kontrak terbuka di pasar sampai <b className="num" style={{ color: 'var(--ink)', fontWeight: 500 }}>{formatTime(job.accept_deadline)}</b>.</>}
          </span>
        </div>
      ));
    }
    case 'in_progress': {
      const rejected = rejectedSubmission(ui, activity);
      if (rel === 'freelancer') return <DeliverableCard job={job} rejected={rejected} />;
      return body('Hasil kerja', (
        <>
          <div className="who">
            <Icon name="briefcase" />
            <span>Freelancer <span className="mono" style={{ color: 'var(--ink)' }}>{shortAddr(job.freelancer_addr)}</span> sedang mengerjakan. Hanya wallet ini yang bisa mengirim hasil.</span>
          </div>
          {rejected && (
            <div className="note note-warn">
              <Icon name="alert" />
              <div>
                <b>Kiriman sebelumnya ditolak cek struktural.</b> Bond freelancer tetap utuh — ia bisa memperbaiki lalu mengirim ulang.
                {(rejected.note || job.last_error) && <div className="err-line warn">{rejected.note || job.last_error}</div>}
              </div>
            </div>
          )}
        </>
      ));
    }
    case 'submitted_pending':
      return body('Hasil kerja', (
        <>
          <DelivBox job={job} />
          <div className="note note-info">
            <span className="spin" aria-hidden="true" />
            <div><b>Oracle sedang mengonfirmasi cek struktural ke kontrak.</b> Sebagian budget cair otomatis ke freelancer setelah ini selesai.</div>
          </div>
          {action}
          {escalation}
        </>
      ));
    case 'structural_failed': {
      const mismatch = isHashMismatch(job);
      return body('Hasil kerja', (
        <>
          <DelivBox job={job} />
          <div className="note note-err">
            <Icon name="alert" />
            <div>
              {mismatch
                ? <><b>Konten di server tidak sama dengan yang ditandatangani freelancer.</b> Hash on-chain tidak bisa diubah, jadi konfirmasi baru bisa berjalan setelah konten yang persis sama dengan saat tanda tangan dikirim ulang. Kalau dalam 2 jam sejak dikirim belum juga, Oracle mengembalikan kontrak ke tahap pengerjaan supaya freelancer bisa mengirim konten baru — bond tetap utuh.</>
                : <><b>Konfirmasi struktural gagal karena gangguan sistem — bukan karena konten.</b> Konten sudah terkunci di hash on-chain, jadi tidak perlu dan tidak bisa diubah. Konfirmasinya bisa dicoba lagi.</>}
              <Tech error={job.last_error} />
            </div>
          </div>
          {mismatch && (rel === 'freelancer'
            ? <ResendSignedContent job={job} />
            : <p className="hint" style={{ margin: 0 }}>Hanya freelancer kontrak ini yang bisa mengirim ulang kontennya.</p>)}
          {action}
          {escalation}
        </>
      ));
    }
    case 'awaiting_verify': {
      return body('Hasil kerja', (
        <>
          <DelivBox job={job} />
          <div className="note note-ok">
            <Icon name="check" />
            <div><b>Lolos cek struktural.</b>{job.structural_released_wei !== '0' && <> <Money wei={job.structural_released_wei} /> sudah cair ke freelancer.</>}</div>
          </div>
          {job.job_state === 'error' && (
            <div className="note note-err">
              <Icon name="alert" />
              <div><b>Percobaan verifikasi terakhir gagal karena gangguan sistem.</b> Dana tidak berpindah; verifikasi bisa dijalankan lagi.<Tech error={job.last_error} /></div>
            </div>
          )}
          {!stuck && <p className="hint" style={{ margin: 0 }}>Langkah berikutnya: verifikasi. Oracle mengukur ulang {subsetSize(n)} dari {n} pertanyaan yang dipilih acak, dengan konten ini sebagai konteks, lalu kontrak membagikan dana sesuai hasilnya. Verifikasi tidak berjalan sendiri — client atau freelancer memicunya di bawah ini.</p>}
          {action}
          {escalation}
        </>
      ));
    }
    case 'verifying': {
      const total = job.verification_subset?.length ?? subsetSize(n);
      const done = phaseHits(job, runs, 'verification').hits.size;
      return body('Hasil kerja', (
        <>
          <Progress done={done} total={total}>
            <b>Oracle memverifikasi — {done} dari {total} pertanyaan terpilih.</b> Hasil dan keputusan settlement muncul otomatis.
          </Progress>
          {action}
          {escalation}
          <DelivBox job={job} />
        </>
      ));
    }
    default:
      return job.deliverable_content ? body('Hasil kerja', <DelivBox job={job} />) : null;
  }
}

// ---------------------------------------------------------------------

const fmtNum = (x: number) => x.toLocaleString('id-ID', { maximumFractionDigits: 2 });

/**
 * Zona abu. Batasnya digambar dari rumus yang sama dengan decide():
 *   refund  : skor ≤ T − 2     cair : skor ≥ T      (T = target × of / n)
 * Angka pecahan di sini hanya untuk MENGGAMBAR; keputusannya sendiri
 * integer dan sudah diambil server.
 */
export function JuryCard({ job, arbiter, rel }: { job: Job; arbiter: string | null; rel: Relation }) {
  const n = job.queries.length;
  const of = job.verification_of;
  let body: ReactNode;

  if (job.verification_score !== null && of) {
    const score = job.verification_score;
    const T = (job.target_count * of) / n, lo = Math.max(T - 2, 0);
    const pct = (x: number) => Math.max(0, Math.min(100, (x / of) * 100));
    const w1 = pct(lo), w3 = 100 - pct(T), w2 = 100 - w1 - w3;
    // Kontrak hanya masuk Disputed kalau decide() = dispute (atau lewat
    // eskalasi). Kalau skornya bilang lain, datanya tidak konsisten —
    // tampilkan, jangan tutupi dengan kalimat yang tidak benar.
    const byFormula = decide({ score, of, target: job.target_count, n });
    body = (
      <>
        {byFormula === 'dispute'
          ? <p style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Skor verifikasi <b>{score} dari {of}</b> jatuh di antara batas refund dan batas cair, jadi keputusan diserahkan ke arbiter.</p>
          : (
            <div className="note note-warn">
              <Icon name="alert" />
              <div>
                <b>Skor {score} dari {of} menurut rumus keputusan berarti {byFormula === 'release' ? 'cair ke freelancer' : 'refund ke client'}, bukan zona abu.</b> Kontrak tetap menunggu putusan arbiter; data verifikasi kontrak ini tidak konsisten.
              </div>
            </div>
          )}
        <div>
          <div className="zone" role="img" aria-label={`Skor ${score}; refund jika ≤ ${fmtNum(lo)}, cair jika ≥ ${fmtNum(T)}`}>
            {w1 > 0 && <span className="z-ref" style={{ width: `${w1}%` }} />}
            <span className="z-grey" style={{ width: `${w2}%` }} />
            <span className="z-rel" style={{ width: `${w3}%` }} />
            <i className="zone-mk" style={{ left: `${Math.min(pct(score), 99.5)}%` }}><b>Skor {score}</b></i>
          </div>
          <div className="zone-l">
            <span><i className="lg lg-n" /> Refund ≤ {fmtNum(lo)}</span>
            <span><i className="lg lg-g" /> Zona abu</span>
            <span><i className="lg lg-y" /> Cair ≥ {fmtNum(T)}</span>
          </div>
        </div>
      </>
    );
  } else {
    body = <p style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>Kontrak ini dieskalasi karena verifikasi macet melewati batas waktu. Belum ada skor — arbiter memutuskan berdasarkan konten dan riwayatnya.</p>;
  }

  return (
    <Card title="Zona abu · perlu putusan arbiter" className="card-warn">
      <div className="card-b stack">
        {body}
        {rel === 'arbiter' ? <ArbiterDecision job={job} /> : (
          <div className="note note-plain">
            <Icon name="lock" />
            <div>
              Hanya arbiter yang bisa memutus kontrak ini. Kontrak menolak transaksi dari alamat lain.
              {arbiter && (
                <div className="who" style={{ marginTop: 8 }}>
                  <a className="mono lnk" style={{ fontSize: 12.5 }} href={addrUrl(arbiter)} target="_blank" rel="noopener noreferrer">{shortAddr(arbiter)}</a>
                  <span style={{ fontSize: 12 }}>arbiter</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------

export function LedgerCard({ job, ui, activity, chain }: { job: Job; ui: UiStatus; activity: ActivityEntry[]; chain: ChainInfo | undefined }) {
  const held = heldInContract(activity);
  const [label, tone] = fundsLabel(job, ui);
  // Persentase hanya untuk DITAMPILKAN, dari kontrak (§A10) — tidak pernah dipakai berhitung.
  const bps = chain?.structuralBps ? Number(chain.structuralBps) : null;
  const structuralLabel = bps !== null && Number.isFinite(bps) ? `Cair struktural · ${fmtNum(bps / 100)}%` : 'Cair struktural';
  const released = job.structural_released_wei !== '0';

  return (
    <Card
      title="Ledger escrow"
      meta={chain?.contractAddress && (
        <a className="txl mono" href={addrUrl(chain.contractAddress)} target="_blank" rel="noopener noreferrer" title={chain.contractAddress}>
          {shortAddr(chain.contractAddress)}<Icon name="ext" />
        </a>
      )}
    >
      <dl className="kv">
        <div><dt>Budget dikunci</dt><dd><Money wei={job.budget_wei} /></dd></div>
        <div><dt>Bond freelancer</dt><dd className={job.bond_wei ? undefined : 'dim'}>{job.bond_wei ? <Money wei={job.bond_wei} /> : '—'}</dd></div>
        <div><dt>{structuralLabel}</dt><dd className={released ? undefined : 'dim'}>{released ? <Money wei={job.structural_released_wei} /> : '—'}</dd></div>
        <div>
          <dt>Masih di kontrak</dt>
          <dd className={held === null ? 'dim' : undefined} title={held === null ? 'Belum bisa dipastikan dari event on-chain' : 'Dihitung dari event on-chain kontrak ini'}>
            {held === null ? '—' : <Money wei={held} />}
          </dd>
        </div>
        <div><dt>Status dana</dt><dd><span className={`fund fund-${tone}`}><i />{label}</span></dd></div>
      </dl>
      {activity.length === 0 && (
        <div className="card-f"><span>Belum ada event on-chain untuk kontrak ini, jadi saldo di kontrak belum bisa ditampilkan.</span></div>
      )}
    </Card>
  );
}
