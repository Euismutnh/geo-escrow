/**
 * Panggil setOracle() di kontrak — untuk dipakai sekali saja.
 *
 * Jalankan:  npx tsx scripts/set-oracle.ts 0xAlamatOracleBaru
 *
 * KENAPA ADA SKRIP INI: kontraknya belum diverifikasi di BscScan, jadi
 * tab "Write Contract" tidak tersedia dan setOracle tidak bisa dipanggil
 * lewat browser.
 *
 * KUNCI OWNER TIDAK PERNAH DISIMPAN. Ia diketik ke prompt yang tidak
 * menampilkan ketikan, dipakai sekali di memori, lalu proses berakhir.
 * Tidak ditulis ke .env.local (yang di repo ini ikut dilacak git), tidak
 * lewat argumen baris perintah (yang masuk riwayat shell dan terlihat di
 * daftar proses), dan tidak pernah dicetak.
 */
process.loadEnvFile('.env.local');
import { createInterface } from 'node:readline';
import { createPublicClient, createWalletClient, http, getAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';
import { geoEscrowAbi } from '../lib/abi';

const RPC = process.env.RPC_URL!;
const KONTRAK = getAddress(process.env.GEO_ESCROW_ADDRESS!);

/**
 * Baca satu baris tanpa menampilkan isinya, tapi tetap menggemakan '*'.
 *
 * Versi pertama membungkam process.stdout.write sepenuhnya. Akibatnya
 * tidak ada cara membedakan "paste berhasil tapi tersembunyi" dari
 * "paste tidak masuk sama sekali" — dan di PowerShell yang kedua justru
 * yang sering terjadi. Bintang memberi umpan balik tanpa membocorkan apa pun.
 *
 * Mode raw dipakai supaya paste — yang datang sebagai satu bongkahan,
 * bukan per-karakter — ikut tertangkap utuh.
 */
function tanyaRahasia(pertanyaan: string): Promise<string> {
  return new Promise((resolve, reject) => {
    process.stdout.write(pertanyaan);

    const stdin = process.stdin;

    // Bukan terminal interaktif (pipe, CI): baca apa adanya.
    if (!stdin.isTTY) {
      const rl = createInterface({ input: stdin });
      rl.question('', (j) => {
        rl.close();
        resolve(j.trim());
      });
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
        if (ch === '') return selesai(null); // Ctrl+C
        if (ch === '' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1);
            process.stdout.write('\b \b');
          }
          continue;
        }
        if (ch < ' ') continue; // abaikan panah & karakter kendali lain
        buf += ch;
        process.stdout.write('*');
      }
    };

    stdin.on('data', onData);
  });
}

async function main() {
  const argumen = process.argv[2];
  if (!argumen) {
    console.error('\n  Pemakaian: npx tsx scripts/set-oracle.ts 0xAlamatOracleBaru\n');
    process.exitCode = 1;
    return;
  }

  let oracleBaru: `0x${string}`;
  try {
    // getAddress memvalidasi checksum, bukan cuma bentuknya. Alamat yang
    // salah ketik satu karakter hampir selalu gagal di sini -- jauh lebih
    // baik daripada lolos lalu peran oracle jatuh ke alamat tak bertuan.
    oracleBaru = getAddress(argumen);
  } catch {
    console.error(`\n  "${argumen}" bukan alamat yang sah (checksum tidak cocok).`);
    console.error('  Salin ulang dari Rabby pakai ikon copy, jangan diketik manual.\n');
    process.exitCode = 1;
    return;
  }

  const pub = createPublicClient({ chain: bscTestnet, transport: http(RPC) });

  const [ownerSekarang, oracleSekarang] = await Promise.all([
    pub.readContract({ address: KONTRAK, abi: geoEscrowAbi, functionName: 'owner' }),
    pub.readContract({ address: KONTRAK, abi: geoEscrowAbi, functionName: 'oracle' }),
  ]);

  console.log('\nsetOracle\n');
  console.log(`  kontrak        ${KONTRAK}`);
  console.log(`  owner          ${ownerSekarang}`);
  console.log(`  oracle sekarang ${oracleSekarang}`);
  console.log(`  oracle baru    ${oracleBaru}\n`);

  if (String(oracleSekarang).toLowerCase() === oracleBaru.toLowerCase()) {
    console.log('  Sudah menunjuk alamat itu. Tidak ada yang perlu dikirim.\n');
    return;
  }

  console.log('  Tempel PRIVATE KEY WALLET OWNER. Ketikanmu tidak akan terlihat,');
  console.log('  dan kuncinya tidak disimpan ke mana pun.\n');

  const mentah = await tanyaRahasia('  kunci owner: ');
  const kunci = (mentah.startsWith('0x') ? mentah : `0x${mentah}`) as Hex;

  if (!/^0x[0-9a-fA-F]{64}$/.test(kunci)) {
    console.error('\n  Bukan private key yang sah (harus 64 karakter heksadesimal).');
    console.error('  Periksa apakah yang tersalin itu ALAMAT wallet, bukan kuncinya.\n');
    process.exitCode = 1;
    return;
  }

  const akun = privateKeyToAccount(kunci);

  // Gerbang: kunci yang salah akan revert dengan pesan mentah EVM yang
  // tidak menunjuk ke mana pun. Dicegat di sini, sebelum gas terbayar.
  if (akun.address.toLowerCase() !== String(ownerSekarang).toLowerCase()) {
    console.error(`\n  Kunci ini milik ${akun.address},`);
    console.error(`  sedangkan owner kontrak ${ownerSekarang}.`);
    console.error('  Hanya owner yang boleh memanggil setOracle().\n');
    process.exitCode = 1;
    return;
  }

  const saldo = await pub.getBalance({ address: akun.address });
  if (saldo === 0n) {
    console.error('\n  Wallet owner tidak punya tBNB sama sekali — tidak bisa membayar gas.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\n  Kunci cocok dengan owner. Menyimulasikan dulu...');

  // Simulasi lebih dulu: revert ketahuan SEBELUM gas terbayar, dan
  // pesannya menyebut alasannya.
  const { request } = await pub.simulateContract({
    account: akun,
    address: KONTRAK,
    abi: geoEscrowAbi,
    functionName: 'setOracle',
    args: [oracleBaru],
  });

  const wallet = createWalletClient({ account: akun, chain: bscTestnet, transport: http(RPC) });
  const hash = await wallet.writeContract(request);
  console.log(`  tx terkirim: ${hash}`);
  console.log('  menunggu receipt...');

  const receipt = await pub.waitForTransactionReceipt({ hash, confirmations: 1, timeout: 90_000 });

  // viem TIDAK melempar untuk transaksi yang masuk blok lalu revert.
  if (receipt.status !== 'success') {
    console.error('\n  Transaksi masuk blok tapi REVERT. Oracle tidak berubah.\n');
    process.exitCode = 1;
    return;
  }

  // Baca ulang dari kontrak — bukti, bukan asumsi.
  const oracleFinal = await pub.readContract({
    address: KONTRAK,
    abi: geoEscrowAbi,
    functionName: 'oracle',
  });

  const cocok = String(oracleFinal).toLowerCase() === oracleBaru.toLowerCase();
  console.log(`\n  oracle sekarang: ${oracleFinal}  ${cocok ? '<- berhasil' : '<- TIDAK COCOK'}`);
  console.log(`  https://testnet.bscscan.com/tx/${hash}\n`);

  if (!cocok) {
    process.exitCode = 1;
    return;
  }

  console.log('  Dua langkah terakhir:\n');
  console.log(`  1. Isi tBNB ke ${oracleBaru} dari faucet BSC Testnet.`);
  console.log('     Tanpa gas, backend tidak bisa mengirim transaksi apa pun.\n');
  console.log('  2. Tempel private key wallet ORACLE (bukan owner) ke .env.local:');
  console.log('       ORACLE_PRIVATE_KEY=0x...\n');
  console.log('     Lalu buktikan: npx tsx scripts/dev-chain-read.ts\n');
}

main().catch((e) => {
  // Pesan error viem bisa panjang; ambil baris pertama yang berarti.
  const pesan = e instanceof Error ? e.message.split('\n')[0] : String(e);
  console.error(`\n  GAGAL: ${pesan}\n`);
  process.exitCode = 1;
});
