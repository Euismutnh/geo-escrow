/**
 * Baca peran tingkat-kontrak + saldo gas-nya.
 *
 * Jalankan: npx tsx scripts/dev-roles.ts
 *
 * TIDAK butuh private key dan TIDAK mengirim transaksi apa pun — semua
 * `eth_call` dan `eth_getBalance`, gratis.
 *
 * Gunanya dua:
 *   1. Membuktikan owner/oracle/arbiter memang tiga alamat berbeda
 *   2. Menjawab "saldonya cukup untuk berapa transaksi?" dengan harga gas
 *      SUNGGUHAN, bukan perkiraan. Gas BSC Testnet ada di 0,1 gwei --
 *      seratus kali lebih murah daripada tebakan wajar 10 gwei, dan salah
 *      menebaknya membuat orang mengejar faucet yang tidak dibutuhkan.
 */
process.loadEnvFile('.env.local');

import { createPublicClient, http, formatEther, formatGwei } from 'viem';
import { bscTestnet } from 'viem/chains';
import { geoEscrowAbi } from '../lib/abi';

const client = createPublicClient({
  chain: bscTestnet,
  transport: http(process.env.RPC_URL),
});

const address = process.env.GEO_ESCROW_ADDRESS as `0x${string}`;

/** Perkiraan gas satu panggilan tulis kontrak escrow ini. */
const GAS_TULIS = 120_000n;

const baca = (functionName: 'oracle' | 'arbiter' | 'owner') =>
  client.readContract({ address, abi: geoEscrowAbi, functionName });

async function main() {
  const [oracle, arbiter, owner, gasPrice] = await Promise.all([
    baca('oracle'),
    baca('arbiter'),
    baca('owner'),
    client.getGasPrice(),
  ]);

  const biayaTx = gasPrice * GAS_TULIS;

  console.log(`\nkontrak     ${address}`);
  console.log(`chainId     ${bscTestnet.id}`);
  console.log(`gas price   ${formatGwei(gasPrice)} gwei`);
  console.log(`per tx      ${formatEther(biayaTx)} tBNB  (asumsi ${GAS_TULIS} gas)\n`);

  const peran: Array<[string, string]> = [
    ['owner  ', String(owner)],
    ['oracle ', String(oracle)],
    ['arbiter', String(arbiter)],
  ];

  for (const [nama, addr] of peran) {
    const saldo = await client.getBalance({ address: addr as `0x${string}` });
    const jatah = biayaTx > 0n ? saldo / biayaTx : 0n;
    console.log(
      `${nama}  ${addr}  ${formatEther(saldo).padEnd(20)} = ${jatah} tx`
    );
  }

  const unik = new Set(peran.map(([, a]) => a.toLowerCase()));
  console.log(
    `\nalamat unik: ${unik.size} dari 3 ${unik.size === 3 ? '(ketiganya berbeda)' : '(ADA YANG SAMA)'}`
  );

  // Oracle membayar 2 transaksi per job yang berjalan penuh:
  // confirmStructural + settleRelease/Refund/raiseDispute.
  const saldoOracle = await client.getBalance({
    address: String(oracle) as `0x${string}`,
  });
  console.log(`oracle cukup untuk ~${saldoOracle / (biayaTx * 2n)} job penuh\n`);
}

main();
