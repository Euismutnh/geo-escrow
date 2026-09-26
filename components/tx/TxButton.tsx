'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { BaseError, type TransactionReceipt } from 'viem';
import { useConfig } from 'wagmi';
import { simulateContract, waitForTransactionReceipt, writeContract } from 'wagmi/actions';
import { buttonClass, type Variant } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/Icon';
import { useSwitchToBsc, useWallet } from '@/components/wallet/useWallet';
import { useWalletUi } from '@/components/wallet/WalletUi';
import { geoEscrowAbi } from '@/lib/abi';
import { apiPost, ApiClientError } from '@/lib/api';
import { isTxHash, shortHash, txUrl } from '@/lib/explorer';
import { useChainInfo } from '@/lib/queries';
import {
  BUSY_LABEL, classifyTxError, isBusy, stepIndex, SYNC_FAILED_MSG, syncDecision, TX_MSG, TX_STEPS,
  type TxCall, type TxState, type UserWriteFn,
} from '@/lib/tx';
import { CHAIN } from '@/lib/wagmi';

/** Batas menunggu receipt. BSC Testnet ±0,45 dtk/blok; 120 dtk ≈ 260 blok. */
const RECEIPT_TIMEOUT_MS = 120_000;
const SYNC_RETRY_MS = 2_100; // server: 1 sync per job per 2 detik

export interface TxButtonProps<F extends UserWriteFn> {
  label: string;
  icon?: IconName;
  variant?: Extract<Variant, 'primary' | 'secondary' | 'success' | 'danger'>;
  block?: boolean;
  /**
   * Isi transaksi, dibuat SAAT DIKLIK (bukan saat render) — mis. acceptJob
   * membaca requiredBond() tepat sebelum mengirim. Boleh melempar Error
   * berpesan manusia; pesannya ditampilkan apa adanya.
   */
  prepare: () => TxCall<F> | Promise<TxCall<F>>;
  /** Job yang di-sync setelah receipt. null = tidak ada (mis. createJob: jobId baru ada di receipt). */
  syncJobId: number | null;
  /** Syarat dari pemanggil, mis. "hanya client kontrak ini". `ok:false` → tombol mati + alasannya. */
  allowed?: { ok: true } | { ok: false; reason: string };
  /**
   * Langkah tambahan SETELAH receipt sukses, SEBELUM sync (Fase 6: POST
   * /api/jobs). Boleh mengembalikan jobId untuk di-sync kalau `syncJobId`
   * baru diketahui dari receipt. Kalau melempar, tombol menawarkan
   * "Coba simpan lagi" dengan receipt yang SAMA — tidak mengirim tx ulang.
   */
  afterReceipt?: (receipt: TransactionReceipt) => Promise<number | void>;
  onDone?: (hash: `0x${string}`, receipt: TransactionReceipt) => void;
  /** Hash didapat (tx SUDAH terkirim) — mis. simpan catatan pemulihan sebelum receipt. */
  onSent?: (hash: `0x${string}`) => void;
  /** Setiap perubahan fase — mis. form terkunci selama isBusy(fase). */
  onPhase?: (phase: TxState['phase']) => void;
  /** Pesan sukses di bawah tombol. */
  doneMessage?: string;
}

/*
 * Pintu bertipe sempit ke simulateContract/writeContract. Tipe asli
 * keduanya generik atas (abi, functionName, args, config); TS tidak bisa
 * menyempitkan union generik F ke overload itu. Bentuk argumen SUDAH
 * dijamin TxCall<F> (functionName ∈ UserWriteFn, args sesuai ABI), jadi
 * yang dilepas di sini hanya pemeriksaan ulang yang sama.
 */
type CallParams = Record<string, unknown>;
type WagmiConfig = ReturnType<typeof useConfig>;
const simulate = simulateContract as unknown as (c: WagmiConfig, p: CallParams) => Promise<{ request: CallParams }>;
const write = writeContract as unknown as (c: WagmiConfig, p: CallParams) => Promise<`0x${string}`>;

async function syncWithRetry(jobId: number): Promise<boolean> {
  for (let attempt = 0; ; attempt++) {
    try {
      await apiPost(`/api/sync/${jobId}`, {});
      return true;
    } catch (e) {
      const code = e instanceof ApiClientError ? e.code : undefined;
      if (syncDecision(code, attempt) === 'retry') { await new Promise((r) => setTimeout(r, SYNC_RETRY_MS)); continue; }
      console.warn(`[tx] sync job ${jobId} gagal:`, e);
      return false;
    }
  }
}

function Steps({ state }: { state: TxState }) {
  const idx = stepIndex(state.phase);
  return (
    <ol className="txs" aria-hidden="true">
      {TX_STEPS.map((l, i) => (
        <li key={l} className={i < idx ? 'd' : i === idx ? 'a' : undefined}>
          {l}{i === 1 && state.hash && idx >= 1 && <span className="mono"> {shortHash(state.hash)}</span>}
        </li>
      ))}
    </ol>
  );
}

function TxLink({ hash }: { hash: string }) {
  if (!isTxHash(hash)) return null;
  return <a className="lnk mono" href={txUrl(hash)} target="_blank" rel="noopener noreferrer">{shortHash(hash)}<Icon name="ext" className="i-xs" /></a>;
}

function Note({ children, tone, icon }: { children: ReactNode; tone?: 'err' | 'ok' | 'warn'; icon?: IconName }) {
  return <p className={tone ? `tx-msg ${tone}` : 'tx-msg'}><Icon name={icon ?? (tone === 'ok' ? 'check' : tone ? 'alert' : 'info')} /><span>{children}</span></p>;
}

/**
 * SATU tombol untuk semua aksi tulis on-chain (blueprint §A13).
 *
 * Alurnya — dikunci di sini supaya tidak ada aksi yang lupa satu langkah:
 *   1. simulasi   — revert ketahuan SEBELUM gas terbayar, dengan alasannya
 *   2. tanda tangan di wallet
 *   3. tunggu receipt; receipt.status diperiksa (viem tidak melempar untuk revert)
 *   4. afterReceipt() kalau ada
 *   5. POST /api/sync/:id — dipanggil DI SINI, jadi mustahil terlewat (handover §4)
 *   6. segarkan cache react-query yang terdampak
 *
 * Setelah tx SUKSES tombol kirim tidak pernah muncul lagi di instance ini
 * — klik kedua pada createJob akan mengunci budget dua kali, dan simulasi
 * tidak bisa mencegahnya karena tx kedua juga sah. Yang boleh diulang
 * hanya langkah sesudah receipt.
 *
 * Penjaga sebelum tombol bisa diklik, berurutan:
 *   chain-info belum ada / CHAIN_ENABLED=false → mati, dengan alasan
 *   wallet terputus → "Hubungkan wallet"   ·   jaringan salah → "Pindah ke BNB Testnet"
 *   syarat pemanggil (peran, status) tidak terpenuhi → mati, dengan alasan
 */
export function TxButton<F extends UserWriteFn>(p: TxButtonProps<F>) {
  const config = useConfig();
  const qc = useQueryClient();
  const chainInfo = useChainInfo();
  const w = useWallet();
  const { openConnect } = useWalletUi();
  const { switchToBsc, isPending: switching } = useSwitchToBsc();
  // `resume`: langkah yang gagal SETELAH receipt sukses — untuk label tombol "lanjutkan".
  const [state, setState] = useState<TxState & { resume?: 'after' | 'sync' }>({ phase: 'idle' });
  const running = useRef(false);
  const set = (next: TxState & { resume?: 'after' | 'sync' }) => { setState(next); p.onPhase?.(next.phase); };
  /** Receipt sukses terakhir + langkah yang gagal sesudahnya — untuk "lanjutkan". */
  const resumeFrom = useRef<{ receipt: TransactionReceipt; step: 'after' | 'sync'; jobId: number | null } | null>(null);

  const cls = buttonClass({ variant: p.variant ?? 'primary', block: p.block });
  const wrap = (children: ReactNode, note?: ReactNode) => <div className={p.block ? 'txw block' : 'txw'}>{children}{note}</div>;

  const invalidate = (jobId: number | null) => {
    if (jobId !== null) {
      qc.invalidateQueries({ queryKey: ['job', jobId] });
      qc.invalidateQueries({ queryKey: ['verdict', jobId] });
    }
    for (const k of ['jobs', 'stats', 'activity', 'oracle-log']) qc.invalidateQueries({ queryKey: [k] });
    // Query wagmi: saldo wallet & kontrak, dan pembacaan kontrak (getJob di
    // panel audit, requiredBond). Kunci diperiksa di @wagmi/core/query:
    // ['balance', …] dan ['readContract', …].
    qc.invalidateQueries({ predicate: (q) => q.queryKey[0] === 'balance' || q.queryKey[0] === 'readContract' });
  };

  /** Langkah 4–6 dengan receipt yang sudah SUKSES. */
  const afterSuccess = async (receipt: TransactionReceipt, from: 'after' | 'sync', knownJobId: number | null) => {
    const hash = receipt.transactionHash;
    let jobId = knownJobId;
    if (from === 'after' && p.afterReceipt) {
      set({ phase: 'after', hash });
      try {
        const id = await p.afterReceipt(receipt);
        if (typeof id === 'number') jobId = id;
      } catch (e) {
        resumeFrom.current = { receipt, step: 'after', jobId };
        invalidate(jobId);
        set({ phase: 'sync_failed', resume: 'after', hash, message: `Transaksi berhasil, tapi langkah berikutnya gagal: ${e instanceof Error ? e.message : 'kesalahan tak terduga'}` });
        return;
      }
    }
    if (jobId !== null) {
      set({ phase: 'sync', hash });
      const synced = await syncWithRetry(jobId);
      invalidate(jobId);
      if (!synced) {
        resumeFrom.current = { receipt, step: 'sync', jobId };
        set({ phase: 'sync_failed', resume: 'sync', hash, message: SYNC_FAILED_MSG });
        p.onDone?.(hash, receipt); // dana SUDAH berpindah — pemanggil boleh lanjut
        return;
      }
    } else {
      invalidate(null);
    }
    resumeFrom.current = null;
    set({ phase: 'done', hash, message: p.doneMessage });
    p.onDone?.(hash, receipt);
  };

  /** Langkah 3. Dipisah supaya "Periksa lagi" (unknown) melanjutkan hash yang SAMA tanpa mengirim ulang. */
  const finish = async (hash: `0x${string}`) => {
    let current = hash;
    set({ phase: 'confirm', hash: current });
    let receipt: TransactionReceipt;
    try {
      receipt = await waitForTransactionReceipt(config, {
        hash: current,
        chainId: CHAIN.id,
        timeout: RECEIPT_TIMEOUT_MS,
        // Dipercepat/diganti di wallet → hash baru; lacak yang baru.
        onReplaced: (r) => { current = r.transaction.hash; set({ phase: 'confirm', hash: current }); },
      });
    } catch (e) {
      set({ ...classifyTxError(e, 'receipt', RECEIPT_TIMEOUT_MS / 1000), hash: current });
      return;
    }
    if (receipt.status !== 'success') {
      set({ phase: 'reverted', hash: receipt.transactionHash, message: TX_MSG.reverted });
      invalidate(p.syncJobId); // gas terpakai → saldo berubah
      return;
    }
    await afterSuccess(receipt, 'after', p.syncJobId);
  };

  const guarded = async (fn: () => Promise<void>) => {
    if (running.current) return; // klik ganda
    running.current = true;
    try { await fn(); } finally { running.current = false; }
  };

  const run = () => guarded(async () => {
    const address = chainInfo.data?.contractAddress as `0x${string}` | null | undefined;
    if (!address || !w.address) return;

    set({ phase: 'check' });
    let call: TxCall<F>;
    try { call = await p.prepare(); }
    catch (e) {
      // Error viem (mis. readContract requiredBond gagal) memuat URL RPC dan
      // isi request di `message` — lewat classifyTxError yang hanya memakai
      // shortMessage/alasan revert. Error biasa = pesan manusia dari pemanggil.
      set(e instanceof BaseError ? classifyTxError(e, 'simulate') : { phase: 'failed', message: e instanceof Error ? e.message : 'Transaksi tidak bisa disiapkan' });
      return;
    }

    // 1. Simulasi — dari akun yang SEDANG terhubung.
    const params = {
      address, abi: geoEscrowAbi, functionName: call.functionName, args: call.args,
      value: call.value, account: w.address, chainId: CHAIN.id,
    };
    let request: CallParams;
    try { request = (await simulate(config, params)).request; }
    catch (e) { set(classifyTxError(e, 'simulate')); return; }

    // 2. Tanda tangan — request HASIL simulasi, bukan params mentah: gas,
    // akun, dan chain yang sudah diperiksa node itulah yang dikirim.
    set({ phase: 'sign' });
    let hash: `0x${string}`;
    try { hash = await write(config, request); }
    catch (e) { set(classifyTxError(e, 'write')); return; }
    p.onSent?.(hash);

    await finish(hash);
  });

  const recheck = () => guarded(async () => { if (state.hash) await finish(state.hash); });
  const resume = () => guarded(async () => {
    const r = resumeFrom.current;
    if (r) await afterSuccess(r.receipt, r.step, r.jobId);
  });

  const disabledMain = (reason?: ReactNode) =>
    wrap(<button type="button" className={cls} disabled>{p.icon && <Icon name={p.icon} />}{p.label}</button>, reason);

  // ---------------- keadaan yang TIDAK bergantung wallet ----------------
  if (isBusy(state.phase)) {
    return wrap(
      <button type="button" className={`${cls} busy`} disabled aria-live="polite"><span className="spin" aria-hidden="true" />{BUSY_LABEL[state.phase]}</button>,
      <Steps state={state} />
    );
  }
  if (state.phase === 'done') {
    return wrap(
      <button type="button" className={cls} disabled><Icon name="check" />{p.label}</button>,
      <Note tone="ok">{state.message ?? 'Transaksi berhasil.'} {state.hash && <TxLink hash={state.hash} />}</Note>
    );
  }
  if (state.phase === 'sync_failed') {
    return wrap(
      <button type="button" className={buttonClass({ variant: 'secondary', block: p.block })} onClick={resume}>
        <Icon name="refresh" />{state.resume === 'after' ? 'Coba simpan lagi' : 'Sinkronkan ulang'}
      </button>,
      <Note tone="warn">{state.message} {state.hash && <TxLink hash={state.hash} />}</Note>
    );
  }
  if (state.phase === 'unknown' && state.hash) {
    return wrap(
      <span className="txw-row">
        <button type="button" className={buttonClass({ variant: 'secondary' })} onClick={recheck}><Icon name="refresh" />Periksa lagi</button>
        <TxLink hash={state.hash} />
      </span>,
      <Note tone="warn" icon="clock">{state.message}</Note>
    );
  }

  // ---------------- penjaga ----------------
  if (chainInfo.isPending) return disabledMain();
  if (chainInfo.isError || !chainInfo.data.contractAddress) {
    return disabledMain(<Note tone="warn">Alamat kontrak tidak terbaca dari server — transaksi belum bisa dikirim.</Note>);
  }
  if (!chainInfo.data.chainEnabled) {
    // Kontraknya hidup di testnet, tapi server tidak mengindeksnya. Tx yang
    // tetap dikirim mengunci dana tanpa jejak di UI (job yatim, §A7/A8).
    return disabledMain(<Note>Blockchain dinonaktifkan di server (mode pengembangan). Transaksi tidak dikirim, supaya dana tidak terkunci tanpa tercatat.</Note>);
  }
  if (w.restoring) return wrap(<button type="button" className={cls} disabled><span className="spin" aria-hidden="true" />Memulihkan wallet…</button>);
  if (!w.address) {
    return wrap(<button type="button" className={buttonClass({ variant: 'secondary', block: p.block })} onClick={openConnect}><Icon name="wallet" />Hubungkan wallet</button>);
  }
  if (w.wrongChain) {
    return wrap(<button type="button" className={buttonClass({ variant: 'net', block: p.block })} onClick={switchToBsc} disabled={switching}><Icon name="refresh" />Pindah ke BNB Testnet</button>);
  }
  if (p.allowed && !p.allowed.ok) return disabledMain(<Note>{p.allowed.reason}</Note>);

  // ---------------- siap ----------------
  let msg: ReactNode = null;
  if (state.phase === 'rejected') msg = <Note>{state.message}</Note>; // netral — bukan merah
  if (state.phase === 'blocked' || state.phase === 'failed') msg = <Note tone="err">{state.message}</Note>;
  if (state.phase === 'reverted') msg = <Note tone="err">{state.message} {state.hash && <TxLink hash={state.hash} />}</Note>;
  return wrap(<button type="button" className={cls} onClick={run}>{p.icon && <Icon name={p.icon} />}{p.label}</button>, msg);
}
