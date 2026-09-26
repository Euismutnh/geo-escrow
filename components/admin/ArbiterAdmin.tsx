'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { TxButton } from '@/components/tx/TxButton';
import { Icon } from '@/components/ui/Icon';
import { Money } from '@/components/ui/Money';
import { useTbnbBalance, useWallet } from '@/components/wallet/useWallet';
import { checkNewArbiter } from '@/lib/admin';
import { addrUrl } from '@/lib/explorer';
import { shortAddr } from '@/lib/format';
import { useChainInfo } from '@/lib/queries';
import { sameAddr } from '@/lib/tx';

/** Server meng-cache chain-info 60 dtk (lib/chain-server.ts) — segarkan lagi sesudahnya. */
const CHAIN_INFO_CACHE_MS = 65_000;

/**
 * Ganti arbiter — HANYA tampil untuk wallet owner kontrak.
 *
 * Arbiter hasil deploy (0xd1ff…) kuncinya tidak diketahui siapa pun; tanpa
 * menggantinya, job yang masuk zona abu terkunci selamanya (hanya
 * arbiterDecide yang bisa menyelesaikan Disputed). Owner menandatangani di
 * wallet-nya sendiri — private key tidak pernah keluar dari wallet.
 */
export function ArbiterAdmin() {
  const qc = useQueryClient();
  const w = useWallet();
  const chain = useChainInfo().data;
  const [input, setInput] = useState('');
  const bal = useTbnbBalance(chain?.arbiter);

  if (!chain?.owner || !chain.chainEnabled || !w.address || !sameAddr(w.address, chain.owner)) return null;

  const c = checkNewArbiter(input, { current: chain.arbiter, owner: chain.owner, oracle: chain.oracle, me: w.address });
  const refresh = () => qc.invalidateQueries({ queryKey: ['chain-info'] });

  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <div className="card-h"><h3>Admin kontrak · ganti arbiter</h3><span className="meta">hanya terlihat oleh owner</span></div>
      <div className="card-b stack">
        <dl className="sum" style={{ margin: 0 }}>
          <div className="sum-row">
            <dt>Arbiter sekarang</dt>
            <dd>{chain.arbiter ? <a className="mono lnk" href={addrUrl(chain.arbiter)} target="_blank" rel="noopener noreferrer">{shortAddr(chain.arbiter)}</a> : '—'}</dd>
          </div>
          <div className="sum-row">
            <dt>Saldo gas arbiter</dt>
            <dd>{bal.data ? <Money wei={bal.data.value} short /> : bal.isError ? 'tidak terbaca' : '…'}</dd>
          </div>
        </dl>
        {bal.data?.value === 0n && (
          <div className="note note-warn">
            <Icon name="alert" />
            <div><b>Arbiter tidak punya tBNB.</b> Ia tidak bisa mengirim putusan. Isi sekitar 0,001 tBNB ke alamatnya setelah diganti.</div>
          </div>
        )}
        <div className="field">
          <label className="label" htmlFor="f-arbiter">Alamat arbiter baru</label>
          <input id="f-arbiter" className="input mono" value={input} onChange={(e) => setInput(e.target.value)}
            placeholder="0x…" autoComplete="off" spellCheck={false} aria-describedby="f-arbiter-hint" />
          <div className="hint" id="f-arbiter-hint">Wallet terpisah dari client, freelancer, dan Oracle. Hanya wallet ini yang nanti bisa memutus kontrak di zona abu.</div>
        </div>
        <TxButton
          label="Ganti arbiter"
          icon="shield"
          syncJobId={null}
          allowed={input.trim() === '' ? { ok: false, reason: 'Tempel alamat arbiter baru.' } : c.ok ? { ok: true } : { ok: false, reason: c.reason }}
          prepare={() => {
            if (!c.ok) throw new Error(c.reason);
            return { functionName: 'setArbiter', args: [c.address] as const };
          }}
          onDone={() => {
            setInput('');
            refresh();
            setTimeout(refresh, CHAIN_INFO_CACHE_MS);
          }}
          doneMessage="Arbiter diganti di kontrak. Tampilan aplikasi mengikuti dalam ±1 menit (cache server)."
        />
      </div>
    </section>
  );
}
