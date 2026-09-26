/**
 * Cek saldo tBNB wallet — HANYA MEMBACA. Tidak ada transaksi, tidak ada
 * wallet client; yang dipakai cuma eth_getBalance & eth_call.
 *
 * Jalankan:
 *   npx tsx scripts/dev-balance.ts                       # owner, oracle, arbiter, kontrak
 *   npx tsx scripts/dev-balance.ts 0xAlamat 0xAlamat2    # + alamat tertentu (mis. freelancer)
 *   npx tsx scripts/dev-balance.ts --key                 # + dari private key (input tersembunyi)
 *
 * Untuk saldo, yang dibutuhkan hanya ALAMAT. `--key` hanya untuk kalau
 * alamatnya tidak diketahui: kuncinya diketik ke prompt yang menampilkan
 * '*', dipakai di memori untuk menurunkan alamat, lalu dibuang. Tidak
 * disimpan, tidak lewat argumen (masuk riwayat shell), tidak dicetak.
 */
process.loadEnvFile('.env.local');
import { createInterface } from 'node:readline';
import { createPublicClient, formatEther, getAddress, http, isAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { geoEscrowAbi } from '../lib/abi';

const RPC = process.env.NEXT_PUBLIC_RPC_URL || process.env.RPC_URL;
const KONTRAK = process.env.GEO_ESCROW_ADDRESS;
const GAS_PER_TX = 120_000n; // perkiraan satu panggilan tulis kontrak ini

function tanyaRahasia(pertanyaan: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(pertanyaan);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      const rl = createInterface({ input: stdin });
      rl.question('', (j) => { rl.close(); resolve(j.trim()); });
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const selesai = (hasil: string | null) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      if (hasil === null) reject(new Error('dibatalkan'));
      else resolve(hasil.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') return selesai(buf);
        if (ch === '\u0003') return selesai(null); // Ctrl+C
        if (ch === '\u007f' || ch === '\b') {
          if (buf.length > 0) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); }
          continue;
        }
        if (ch < ' ') continue;
        buf += ch;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  if (!RPC || !KONTRAK) throw new Error('RPC_URL / GEO_ESCROW_ADDRESS belum diisi di .env.local');
  const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
  const kontrak = getAddress(KONTRAK);

  const baca = (fn: 'owner' | 'oracle' | 'arbiter') => client.readContract({ address: kontrak, abi: geoEscrowAbi, functionName: fn });
  const [owner, oracle, arbiter, gasPrice] = await Promise.all([baca('owner'), baca('oracle'), baca('arbiter'), client.getGasPrice()]);
  const peran = new Map<string, string>([
    [getAddress(owner), 'owner'],
    [getAddress(oracle), 'oracle'],
    [getAddress(arbiter), 'arbiter'],
    [kontrak, 'KONTRAK (dana escrow)'],
  ]);

  const daftar: { alamat: `0x${string}`; asal: string }[] = [...peran].map(([a, p]) => ({ alamat: a as `0x${string}`, asal: p }));

  const args = process.argv.slice(2);
  for (const a of args.filter((x) => x !== '--key')) {
    if (!isAddress(a)) { console.error(`  lewati "${a}": bukan alamat yang sah`); continue; }
    const g = getAddress(a);
    if (!peran.has(g)) daftar.push({ alamat: g, asal: 'argumen' });
  }

  if (args.includes('--key')) {
    console.log('Tempel private key (tampil sebagai *). Enter kosong = selesai.');
    for (let i = 1; ; i++) {
      const k = await tanyaRahasia(`  kunci #${i}: `);
      if (!k) break;
      const hex = (k.startsWith('0x') ? k : `0x${k}`) as Hex;
      if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) { console.error('  bukan 64 karakter heksadesimal — kalau itu ALAMAT, berikan sebagai argumen biasa.'); continue; }
      const g = privateKeyToAccount(hex).address; // kuncinya tidak disimpan di mana pun
      if (!peran.has(g) && !daftar.some((d) => d.alamat === g)) daftar.push({ alamat: g, asal: 'private key' });
      else console.log(`  → ${g} (sudah ada di daftar)`);
    }
  }

  const saldo = await Promise.all(daftar.map((d) => client.getBalance({ address: d.alamat })));
  const perTx = gasPrice * GAS_PER_TX;
  console.log(`\nBSC Testnet · gas ${Number(gasPrice) / 1e9} gwei · ±${formatEther(perTx)} tBNB per tx\n`);
  daftar.forEach((d, i) => {
    const b = saldo[i];
    const label = peran.get(d.alamat) ?? d.asal;
    const tx = d.alamat === kontrak ? '' : `  ≈ ${perTx > 0n ? (b / perTx).toString() : '?'} tx`;
    console.log(`  ${label.padEnd(22)} ${d.alamat}  ${formatEther(b).padStart(22)} tBNB${tx}`);
  });
  console.log('');
}

main().catch((e) => { console.error('gagal:', e?.shortMessage ?? e?.message ?? e); process.exit(1); });
