/**
 * Verifikasi ABI terhadap kontrak yang benar-benar hidup di BSC Testnet.
 *
 * Jalankan: npx tsx scripts/dev-chain-check.ts
 *
 * Kalau ABI salah satu huruf pun, panggilan di bawah akan gagal atau
 * mengembalikan nilai yang tidak masuk akal. Ini uji yang tidak bisa
 * dipalsukan: datanya datang dari chain, bukan dari dokumen.
 */
process.loadEnvFile('.env.local');
import { createPublicClient, http, getAddress } from 'viem';
import { bscTestnet } from 'viem/chains';
import { geoEscrowAbi, STATUS_BY_INDEX } from '../lib/abi';

const ADDRESS = '0x41462F3092Ca66b7B3d9c8b20337793e2756cC46' as const;
const RPC = process.env.RPC_URL ?? 'https://bsc-testnet-rpc.publicnode.com';

// Dari catatan serah terima — dibandingkan dengan yang dibaca dari chain.
const DOK = {
  oracle: '0xa3291638aeE37B076E7CA389C3fd28d5B73a4791',
  arbiter: '0xd1ff61def4D7c6dB938A4501f460b5176fcbCd78',
  owner: '0x8766d055bB79B511FCC34Bd1573ce612dFa4057D',
  bondBps: 500n,
  structuralBps: 2000n,
  verifyTimeout: 604800n,
};

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.error(`  FAIL ${name}${detail ? ` -- ${detail}` : ''}`); }
};
const show = (label: string, v: unknown) =>
  console.log('       ' + label.padEnd(24) + String(v));

const client = createPublicClient({ chain: bscTestnet, transport: http(RPC) });
const baca = <T>(functionName: string, args: readonly unknown[] = []) =>
  client.readContract({
    address: ADDRESS,
    abi: geoEscrowAbi,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functionName: functionName as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
  }) as Promise<T>;

async function main() {
  console.log('\nJaringan & kontrak');
  const chainId = await client.getChainId();
  check('chainId = 97 (BSC Testnet)', chainId === 97, String(chainId));
  const code = await client.getBytecode({ address: ADDRESS });
  check('ada bytecode di alamat itu', !!code && code.length > 2,
    `${((code?.length ?? 2) - 2) / 2} byte`);
  const blok = await client.getBlockNumber();
  show('blok terkini', blok);

  console.log('\nRole -- ABI cocok kalau nilainya sama dengan dokumen');
  const oracle = await baca<string>('oracle');
  const arbiter = await baca<string>('arbiter');
  const owner = await baca<string>('owner');
  check('oracle() cocok', getAddress(oracle) === getAddress(DOK.oracle), oracle);
  check('arbiter() cocok', getAddress(arbiter) === getAddress(DOK.arbiter), arbiter);
  check('owner() cocok', getAddress(owner) === getAddress(DOK.owner), owner);

  console.log('\nKonstanta -- membuktikan ABI membaca slot yang benar');
  const bond = await baca<bigint>('BOND_BPS');
  const struct = await baca<bigint>('STRUCTURAL_BPS');
  const timeout = await baca<bigint>('verifyTimeout');
  check('BOND_BPS = 500 (5%)', bond === DOK.bondBps, String(bond));
  check('STRUCTURAL_BPS = 2000 (20%)', struct === DOK.structuralBps, String(struct));
  check('verifyTimeout = 604800 (7 hari)', timeout === DOK.verifyTimeout, String(timeout));

  console.log('\nFungsi yang kita andalkan');
  const jobCount = await baca<bigint>('jobCount');
  show('jobCount()', jobCount);
  check('jobCount() terbaca', typeof jobCount === 'bigint');

  const seed = await baca<string>('verificationSeed', [0n]);
  check('verificationSeed() terbaca', /^0x[0-9a-f]{64}$/.test(seed), seed);

  // getJob() adalah yang paling rawan: bentuk tuple-nya harus cocok
  // persis, kalau tidak viem gagal men-decode.
  console.log('\ngetJob() -- bentuk tuple paling rawan salah');
  try {
    const job = await baca<Record<string, unknown>>('getJob', [0n]);
    const wajib = [
      'client', 'freelancer', 'queryPoolHash', 'deliverableHash', 'verdictHash',
      'verificationSeed', 'budget', 'bond', 'structuralReleased', 'status',
      'acceptDeadline',
    ];
    const hilang = wajib.filter((k) => !(k in job));
    check('11 field lengkap & bernama benar', hilang.length === 0,
      `hilang: ${hilang.join(', ')}`);
    show('status (uint8)', `${job.status} -> ${STATUS_BY_INDEX[Number(job.status)]}`);
    show('budget', job.budget);
    show('acceptDeadline', job.acceptDeadline);
  } catch (e) {
    check('getJob() bisa di-decode', false, e instanceof Error ? e.message : String(e));
  }

  console.log('\n' + '-'.repeat(52));
  console.log(`  lulus: ${pass}   gagal: ${fail}`);
  if (jobCount === 0n) {
    console.log('\n  CATATAN: jobCount = 0, belum ada job sama sekali di kontrak.');
    console.log('  getJob(0) mengembalikan struct kosong -- itu wajar, bukan error.');
    console.log('  Uji sungguhan baru bisa setelah ada yang memanggil createJob().');
  }
  process.exit(fail ? 1 : 0);
}

main();
