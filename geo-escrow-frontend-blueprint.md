# GEO Escrow — Blueprint Frontend v1

> Pendamping `geo-escrow-backend-blueprint-v2.md`. Bentuknya sama: fase bertahap,
> tiap fase menyebut penyesuaian dari rancangan awal **beserta alasannya**, dan
> tiap fase punya cara verifikasi yang benar-benar bisa dijalankan.
>
> Rancangan awal = prototipe HTML (`geo-escrow-demo-neobrutalism.html`) +
> `geo-escrow-ringkasan-3-bagian.md` Bagian 1.
>
> **15 endpoint tidak disentuh.** Tidak ada satu pun fase di bawah yang mengubah
> bentuk request/response. Kalau ada yang tampak butuh perubahan, itu ditulis
> sebagai pertanyaan, bukan sebagai pekerjaan.

---

## 0. Keputusan yang sudah diambil

| # | Keputusan | Konsekuensi di fase |
|---|---|---|
| 1 | **wagmi + `@tanstack/react-query`, tanpa RainbowKit** | Modal 4-wallet dibuat sendiri (Fase 5). `react-query` wajib untuk wagmi — jadi dipakai sekalian untuk semua fetching (Fase 3), nol dependensi cache tambahan |
| 2 | **Arah redesign: editorial / fintech bersih** | Fase 1. Lihat peringatan di §0.1 |
| 3 | **Mockup HTML statis dulu, komponen menyusul** | Fase 1 tidak menghasilkan kode React sama sekali |
| 4 | **Polling, bukan Supabase Realtime** | Fase 9. RLS tetap mati, `NEXT_PUBLIC_SUPABASE_ANON_KEY` tetap kosong — keduanya terikat |

### 0.1 Peringatan tentang keputusan #2

Anda menulis *"pertahankan palet warna-nya"* lalu memilih **editorial / fintech
bersih**. Keduanya tidak sepenuhnya sejalan, dan saya tidak mau Anda kaget di
Fase 1.

Editorial mempertahankan **identitas hue** — hijau tetap hijau, biru tetap biru,
tujuh peran warnanya tetap tujuh — tapi **menurunkan pangkatnya dari pengisi
bidang jadi aksen**. Lime `#B6FF3C` yang sekarang mengisi seluruh tombol akan
jadi hijau tua `#1B6B36` di atas latar `#ECF6EF`. Warnanya masih keluarga yang
sama; porsinya yang berubah drastis.

Yang **hilang**: shadow keras `5px 5px 0`, border 3–4px, Archivo Black
semua-kapital, latar krem `#FFF7E3`. Itu justru empat hal yang membuat prototipe
langsung dikenali dari jauh.

**Layout, struktur, dan seluruh mockup tetap 100% sama.** Sidebar, topbar, grid
kartu, dua kolom di halaman detail, radar, timeline — tidak ada yang digeser.

Kalau setelah melihat Fase 1 Anda merasa terlalu jinak, jalan mundurnya murah:
naikkan `--radius` ke 0, tebalkan `--line` ke 2px, kembalikan shadow keras. Tiga
baris token, bukan tulis ulang.

---

## A. Yang keliru di rancangan awal

Bagian ini sengaja ditulis sebelum fase, bukan disebar di dalamnya. Semuanya
sudah saya cek ke kode yang terpasang, bukan ke ingatan.

### A1. Dua dokumen Anda saling bertabrakan soal live update

`Ringkasan §1.9` menulis **"Supabase Realtime menggantikan `pollShared()`"**.
`handover §3.7` menulis **"Polling, bukan Supabase Realtime"** dan menambahkan
bahwa anon key sengaja kosong dan RLS sengaja mati — **keduanya terikat**.

Handover lebih baru dan alasannya lebih kuat (biaya, plus RLS mati). Yang
berlaku: polling. `Ringkasan §1.9` baris itu sudah usang dan sebaiknya dicoret
supaya orang ketiga tidak mengikutinya.

### A2. Jumlah status UI di dokumen sudah tidak cocok dengan kode

`Ringkasan §1.9` menulis *"prototipe punya 10 status UI, on-chain cuma 7"*.
`lib/status.ts:15-28` yang sudah terpasang punya **13**.

Tiga di antaranya **tidak punya gambar sama sekali** di mockup mana pun:

| `UiStatus` | Kenapa ada | Yang belum ada di mockup |
|---|---|---|
| `baseline_running` → `baseline_failed` | `retryable: true` | Tombol "Ukur ulang baseline" |
| `submitted_pending` | Cek struktural jalan di backend, bukan instan seperti di prototipe | Keadaan "menunggu" antara submit dan `awaiting_verify` |
| `structural_failed` | `retryable: true` | Tombol "Coba lagi" + tampilan `last_error` — lihat koreksi di bawah |

> **Koreksi (ditemukan saat Fase 1).** Versi pertama menyebut tombolnya "Perbaiki
> & kirim ulang". Itu salah. `lib/flows/structural.ts:105-111` membedakan dua hal:
>
> | Yang terjadi | Status | `job_state` | UI |
> |---|---|---|---|
> | Konten **ditolak** aturan (`rejectStructural`) | kembali ke `Accepted` | `idle` + `last_error` terisi | `in_progress` + banner alasan, form kirim ulang |
> | **Sistem** gagal (RPC, tx, hash tidak cocok) | tetap `Submitted` | `error` | `structural_failed` + "Coba lagi" |
>
> Di kasus kedua kontennya sudah **beku** di hash on-chain — tidak perlu dan
> tidak bisa diubah. "Coba lagi" memanggil `POST /api/sync/:id`, yang memicu ulang
> `confirmStructural()` lewat `after()`; lock-nya memang menerima `error`
> (`flows/structural.ts:51`).

Prototipe menangani kegagalan lewat **toast sesaat** (`pushToast('error', …)`).
Backend menyimpannya **permanen** di `job_state='error'` + `last_error`. Artinya
job yang gagal punya keadaan yang harus digambar, bukan cuma pesan yang lewat.
Tanpa ketiga UI di atas, job gagal akan menampilkan spinner selamanya — persis
yang diperingatkan komentar di `lib/status.ts:10-13`.

### A3. Sekitar 40% JavaScript prototipe adalah backend yang disimulasikan

Prototipe memanggil `https://api.anthropic.com/v1/messages` **langsung dari
browser**, tanpa API key (`callOracle()`). Itu hanya jalan di sandbox tempat
prototipe dibuat. Di FE sungguhan mustahil: tidak ada API key yang boleh ada di
browser.

Dan memang tidak perlu — Oracle sudah jalan di server. Yang **dihapus**, bukan
di-port:

`callOracle` · `runBaseline` · `actionRunVerification` · `settleContract` ·
`pickVRFSubset` · `textHitsBrand` · `logActivity` · `logOracle` · `genHash` ·
`genFakeAddr` · `makeDefaultAccounts` · `sanitizeAccounts` · `persist` ·
`loadState` · `pollShared` · seluruh `SHARED_KEY`/`LOCAL_KEY`

Ini bukan penyederhanaan — ini pemindahan tanggung jawab yang sudah selesai
dikerjakan di backend.

### A4. Model "satu koneksi, banyak akun" tidak punya padanan di wallet sungguhan

Prototipe membuat tiga akun palsu (`makeDefaultAccounts()`) dan menyediakan
layar **"Pilih akun"** + tombol **"Ganti akun"**.

wagmi memberi **satu** akun aktif. Daftar akun ada di dalam ekstensi wallet,
bukan di aplikasi — aplikasi tidak boleh dan tidak bisa menukarnya. Layar "Pilih
akun" dibuang; yang tersisa hanya "Putuskan koneksi".

Yang **tetap benar** dan harus dipertahankan: penentuan peran client/freelancer
otomatis dari perbandingan alamat (`relationToContract()`), bukan dipilih manual.
Itu keputusan yang bagus dan cocok dengan `GET /api/jobs?wallet=`.

### A5. Kartu "Escrow Vault" tidak punya sumber data — ini gap, bukan detail

Mockup `Ringkasan §1.1` menampilkan kartu kedua:

```
┌─ Escrow Vault ───┐
│ 0xE5C4…VLT       │
│ 0.09 tBNB        │
└──────────────────┘
```

Di prototipe itu `state.vault`, objek lokal dengan alamat karangan
(`genFakeAddr()`). Di dunia nyata **tidak ada alamat vault** — dana escrow ada di
kontrak `GeoEscrow` itu sendiri.

`GET /api/stats` mengembalikan `{asClient, asFreelancer, needJury, done}` —
**tidak ada saldo apa pun**. Tabel API di `Ringkasan §1.1` hanya menyebut
`useBalance()` untuk "wallet saya", tidak untuk vault.

Sumber yang benar, dan tidak butuh endpoint baru:

```
contractAddress ← GET /api/chain-info
saldo vault     ← useBalance({ address: contractAddress })
```

Labelnya juga sebaiknya jujur: **"Terkunci di kontrak"**, bukan "Escrow Vault" —
karena itu memang saldo kontrak, bukan dompet terpisah.

### A6. Panel juri: mengunci ke arbiter saja tidak cukup

Handover §3.5 benar — panel harus dikunci ke `arbiter` dari `GET /api/chain-info`.
Tapi ada satu langkah lagi yang tidak tercatat di dokumen mana pun.

`handover §6` mencatat: arbiter `0xd1ff61def4D7c6dB938A4501f460b5176fcbCd78`
punya **0 tBNB**.

Jadi bahkan setelah panelnya dikunci dengan benar dan hanya muncul untuk wallet
yang tepat, `arbiterDecide()` akan **gagal karena tidak ada gas**. Ini blocker
demo, dan blocker yang tidak akan ketahuan sampai detik Anda menekan tombolnya di
panggung. Ditangani di Fase 8 sebagai langkah operasional, bukan sebagai kode.

### A7. `acceptDeadline` punya jebakan waktu yang belum tercatat

`Ringkasan §3.3` masih menulisnya sebagai pertanyaan terbuka: *"unix detik atau
nomor blok?"*. Kode sudah menjawabnya, dan jawabannya **dua bentuk sekaligus**:

| Tujuan | Bentuk | Sumber |
|---|---|---|
| `createJob(...)` on-chain | `uint64` unix **detik** | `lib/abi.ts:74` |
| `POST /api/jobs` | **string ISO** | `requireFutureDate`, `lib/validate-input.ts:96-108` |

Jebakannya ada di baris `lib/validate-input.ts:104`:

```ts
if (t <= Date.now()) throw new ApiError('VALIDATION', `${field} harus di masa depan`);
```

`Date.now()` dievaluasi **saat POST**, dan POST terjadi **setelah** transaksi
dapat receipt. Kalau user memilih batas ambil yang terlalu dekat, urutannya jadi:

```
tx createJob sukses  →  job ADA di blockchain (budget terkunci)
POST /api/jobs       →  ditolak VALIDATION "harus di masa depan"
                     →  job TIDAK ADA di database
```

Hasilnya job yatim: dana terkunci on-chain, tidak muncul di UI mana pun, dan
satu-satunya jalan keluar adalah `reclaimExpired()` setelah deadline lewat.

Dua pagar di Fase 6: form memaksa lead time minimum (**≥ 1 jam**), dan **satu
nilai yang sama** dipakai untuk kedua panggilan — dihitung sekali, tidak dibaca
ulang dari input di antara dua langkah.

### A8. Saat `CHAIN_ENABLED=false`, FE tidak punya sumber `jobId`

Ini yang paling mengganggu, karena menyentuh halaman pertama yang mau Anda
kerjakan.

`handover §8` menyarankan mulai dari `/create`. `handover §6` mencatat
`CHAIN_ENABLED` masih `false` — **disengaja**, supaya FE bisa dibangun tanpa
membayar gas. Tapi:

- `POST /api/jobs` **mewajibkan** `jobId` (`requireJobId`, `lib/validate-input.ts:80`)
- Normalnya `jobId` datang dari receipt `createJob`
- Dengan chain mati, tidak ada tx, tidak ada receipt, **tidak ada `jobId`**

Tidak ada dokumen yang membahas ini. Tanpa jalan keluar, `/create` tidak bisa
jalan sama sekali di mode yang sedang aktif sekarang.

**Jalan keluarnya tidak mengubah endpoint apa pun** (Fase 6):

```ts
// HANYA saat chainEnabled === false. Diberi nama gamblang supaya
// tidak pernah tersangkut ke jalur produksi.
async function jobIdDevSaja(): Promise<number> {
  const { jobs } = await api('/api/jobs?limit=50');
  return Math.max(-1, ...jobs.map(j => j.job_id)) + 1;
}
```

Kalau meleset (dua tab bersamaan), `POST /api/jobs` membalas
`VALIDATION "Job N sudah terdaftar"` — FE coba `+1` sekali lagi. Route-nya sendiri
sudah menolak kombinasi produksi + chain mati (`app/api/jobs/route.ts:78`), jadi
cabang ini secara struktural tidak bisa hidup di produksi.

### A9. `jobId` pertama adalah 0 — dan ini menyentuh lebih dari satu tempat

`handover §3.3` sudah memperingatkan `if (!jobId)`. Tambahannya: ini juga berlaku
di **routing**. URL `/jobs/0` adalah URL yang sah dan harus bisa dibuka. Jadi
setiap `if (!id)`, `id || fallback`, dan `Number(id) ? … : …` di layer routing
adalah bug yang sama dengan pakaian berbeda. Yang benar hanya
`Number.isSafeInteger(n) && n >= 0`.

### A10. Bond tidak boleh dihitung di FE

Prototipe: `const bond = +(c.budget * 0.05).toFixed(6)`.

`Ringkasan §3.3` mengunci `acceptJob` menolak `value` yang **tidak persis sama**
dengan `requiredBond(jobId)`. Perkalian floating-point di JS terhadap nilai wei
hampir pasti meleset di digit terakhir, dan transaksinya akan revert dengan pesan
yang tidak informatif.

Yang benar: baca view `requiredBond(jobId)` → dapat `bigint` → kirim apa adanya
sebagai `value`. Angka 5% **tidak pernah** muncul di kode FE. Hal yang sama
berlaku untuk 20% structural — `bondBps` dan `structuralBps` dari
`GET /api/chain-info` hanya untuk **ditampilkan**, tidak untuk berhitung.

### A11. Radar sitasi: bentuk data `oracle_runs` berbeda dari asumsi prototipe

Prototipe menyimpan `hit` yang **sudah digabung** per pertanyaan.
`oracle_runs` menyimpan **satu baris per (`query_index`, `engine`)** —
`lib/types.ts:80-92`. Dengan `multi_engine=true` ada **dua baris** per pertanyaan.

Jadi FE harus menggabungkan sendiri, dan harus memakai aturan gabung yang
**sama persis** dengan backend. Kalau tidak, angka di radar akan berbeda dari
skor yang dipakai verdict — dan itu justru angka yang dipakai juri menilai klaim
"trustless". Tidak disebut di `Ringkasan §1.5`.

> **Koreksi (ditemukan saat Fase 1).** Versi pertama bagian ini menyuruh
> mengimpor aturannya dari `lib/scoring.ts`. **Aturannya tidak ada di sana** —
> `lib/scoring.ts` hanya berisi `decide()` dan `scaledTarget()`. Aturan gabung
> tinggal di `lib/oracle/runner.ts:170-184`:
>
> - hit **hanya** kalau lolos di **semua** engine (`every`)
> - engine yang belum lengkap = pertanyaan itu **belum punya hasil**, bukan "tidak hit"
>
> Dan `runner.ts` itu kode **server** (mengimpor `db`) — FE tidak bisa dan tidak
> boleh mengimpornya.

> **Disetujui & dikerjakan 2026-09-24.** `hitPerQuery(runs, engineIds)` ada di
> `lib/scoring.ts`; `runner.ts` memakainya dan tetap melempar error kalau hasil tidak
> lengkap. Uji exhaustive membuktikannya identik dengan aturan lama di 756 kombinasi.
>
> **Penjaga yang wajib di Fase 4:** frontend **tidak tahu** engine mana yang aktif di server
> (`enginesFor()` membaca `ORACLE_PROVIDER`, hanya ada di server). Jadi radar mengambil
> `engineIds` dari engine yang muncul di baris `oracle_runs` job itu — dan kalau
> `multi_engine = true` tapi baru satu engine yang terlihat, **semua** pertanyaan harus
> dianggap belum lengkap. Tanpa penjaga ini, pertanyaan yang baru dijawab satu gaya akan
> tampil sebagai hasil final.

**Usulan awal** (bukan bentuk endpoint): ekstrak aturan itu jadi fungsi murni `hitPerQuery(runs, engineIds)`
di `lib/scoring.ts`, lalu `runner.ts` memanggilnya dan FE mengimpornya. Satu
sumber aturan, dua pemakai — pola yang sama dengan `lib/hash.ts`. Verifikasinya:
`npm run check` harus tetap 176 hijau setelah ekstraksi.

Kalau tidak disetujui, alternatifnya menyalin `every()` di FE dengan komentar
yang menunjuk `runner.ts:170` — lebih rapuh, karena perubahan aturan di server
tidak akan ketahuan di FE.

**Satu hal lagi yang terlihat dari sini:** kolom `engine` menyimpan **id**, bukan
label — `claude-ringkas`/`claude-naratif` (`lib/oracle/claude.ts:44-45`), atau
`mock-a`/`mock-b` saat `ORACLE_PROVIDER=mock`. FE memetakan id → `name` milik
provider; menampilkan `mock-a` apa adanya saat mode mock itu **benar**, karena
itulah yang sebenarnya menjawab.

### A12. Tiga aksi ada di tabel API tapi tidak ada di gambar mana pun

`Ringkasan §1.5` menyebut ketiganya di kolom Blockchain/API, tapi mockup
ASCII-nya tidak punya tempat untuk mereka:

| Aksi | Kapan muncul | Siapa |
|---|---|---|
| `reclaimExpired(jobId)` | status `open` **dan** `accept_deadline` sudah lewat | client |
| `escalateStuckJob(jobId)` | macet lewat `verifyTimeout` | siapa saja |
| `GET /api/jobs/:id/verdict` | setelah settle — panel audit | siapa saja |

Yang ketiga paling disayangkan kalau hilang: itu satu-satunya layar yang
**membuktikan** klaim "hasilnya diukur, bukan diklaim" — ia membandingkan hash
DB vs on-chain dan menampilkan `audit.allChecksPassed`. Digambar di Fase 4 dan
Fase 8.

### A13. Prototipe tidak punya konsep transaksi yang tertunda

Semua aksi di prototipe sinkron — klik, state berubah, selesai. Dengan wallet
sungguhan tiap aksi tulis punya **empat** keadaan:

```
minta tanda tangan  →  terkirim (ada txHash)  →  menunggu receipt  →  POST /api/sync/:id
```

Plus dua cabang gagal: user menolak di wallet (`UserRejectedRequestError` — bukan
error, jangan ditampilkan merah), dan tx revert (itu baru error).

Mockup tidak menyediakan tempat untuk ini. Ditangani di Fase 5 sebagai satu
komponen `<TxButton>` yang dipakai ulang oleh kelima aksi tulis, bukan disalin
lima kali.

### A14. Sisa-sisa sandbox yang tidak punya padanan

| Di prototipe | Nasibnya |
|---|---|
| Tombol **"Reset demo"** di topbar | **Dibuang.** Tidak ada endpoint reset. Yang ada `POST /api/dev/seed`, dan itu ditolak di produksi |
| Pill **"● live sync"** | **Dibuang.** Bergantung `window.storage`, API sandbox |
| `state.busy` global | **Dibuang.** Diganti status per-aksi dari react-query + wagmi |
| Label **"Mesin A / Mesin B"** | → `Claude (ringkas)` / `Claude (naratif)` (handover §4) |
| Checkbox **"≥2 mesin AI"** | → **"Wajib lolos di 2 gaya penjawab"** |

### A15. Sisa scaffold `create-next-app` masih ada di repo

`app/layout.tsx:16-17` masih `title: "Create Next App"`. `app/globals.css` masih
token bawaan + `font-family: Arial`. Keduanya harus diganti — ini pekerjaan
nyata, bukan kosmetik, karena `globals.css` adalah tempat token desain Fase 1
mendarat. Fase 2.

### A16. Utang CSP yang sengaja ditunda, jatuh tempo setelah FE ada

`next.config.ts:83-87` menulis eksplisit bahwa CSP untuk **halaman** sengaja
belum dipasang, karena memasangnya sebelum FE ada hampir pasti memblokir skrip
wallet dengan pesan yang sulit dilacak. Sekarang FE-nya ada, jadi utangnya jatuh
tempo. Fase 10.

### A17. Yang langka bukan gas, tapi tBNB untuk BUDGET escrow

Versi pertama temuan ini menyatakan Oracle hampir kehabisan gas. **Itu salah,
dan salahnya seratus kali lipat.** Saya menebak gas BSC Testnet di 10 gwei
(wajar untuk mainnet). Pembacaan sungguhan:

```
gas price   0.1 gwei
per tx      0.000012 tBNB   (asumsi 120.000 gas)

owner    0.003537  = 294 tx
oracle   0.006     = 500 tx   -> ~250 job penuh
arbiter  0         = 0 tx
```

Jadi **gas bukan masalah sama sekali.** Oracle sanggup ~250 job penuh dengan
saldo yang sudah ada. Kesalahan ini sempat mengirim kami mengejar faucet selama
sejam untuk sesuatu yang tidak dibutuhkan — dicatat di sini supaya tidak
terulang. Perintah yang mengikat:

```bash
npx tsx scripts/dev-roles.ts
```

Yang tersisa dari temuan ini dua, dan keduanya nyata:

**1. Arbiter benar-benar 0 — tidak bisa mengirim satu transaksi pun.** Tapi
perbaikannya sepele: kirim **0,001 tBNB dari owner** (yang punya 0,0035) di
testnet. Itu 83 transaksi arbiter, jauh lebih banyak dari yang dibutuhkan demo
mana pun. Tidak butuh faucet, tidak butuh BNB asli.

**2. Yang benar-benar langka adalah tBNB untuk BUDGET, bukan untuk gas.** Ini
yang terlewat sepenuhnya di analisis pertama. `createJob` itu `payable` — budget
**terkunci di escrow**, bukan terbakar sebagai gas:

| Pihak | Butuh | Sifatnya |
|---|---|---|
| Client | `budget` penuh + gas | Terkunci sampai settle, lalu cair ke salah satu pihak |
| Freelancer | `requiredBond` (5% budget) + gas | Terkunci, kembali kalau berhasil |
| Oracle / arbiter | gas saja | Terbakar |

Total tBNB di ketiga wallet yang diketahui: **0,0095**. Satu job berbudget 0,02
tBNB — nilai contoh di prototipe — **tidak akan muat**.

Konsekuensi untuk demo: pakai budget kecil (**0,002–0,005 tBNB**), atau pastikan
wallet client di MetaMask Anda punya tBNB sendiri. Angka budget tidak
memengaruhi satu pun logika yang didemokan — persentase bond dan structural
dihitung dari budget, jadi 0,002 menunjukkan alur yang sama persis dengan 0,02.

---

## B. Urutan fase & alasannya berbeda dari saran handover

`handover §8.4` menyarankan **mulai dari `/create`**, karena halaman itu yang
menghasilkan job on-chain pertama dan membuktikan seluruh rantai hidup.

Itu benar sebagai **tujuan**, tapi salah sebagai **langkah pertama**. `/create`
adalah halaman yang paling banyak bergantung pada hal lain: butuh wallet
terhubung, butuh `lib/hash.ts` benar, butuh `acceptDeadline` benar, butuh
`jobId` dari receipt, butuh penanganan tx tertunda, dan butuh shell + token
desain sudah ada. Mengerjakannya duluan berarti men-debug enam hal sekaligus.

Penyesuaian: `/create` tetap jadi **halaman tulis pertama** (Fase 6), tapi
didahului lima fase yang masing-masing bisa diverifikasi sendiri. Saat Fase 6
tiba, satu-satunya hal baru yang bisa salah adalah `/create` itu sendiri.

```
Fase 0  Fondasi & pagar memori          ── tanpa UI
Fase 1  Redesign: mockup HTML statis    ── tanpa React
Fase 2  Token, shell, rute kosong
Fase 3  Halaman baca-saja (list)
Fase 4  Halaman detail (baca-saja)
Fase 5  Wallet + <TxButton>
Fase 6  TULIS #1 — /create              ← target handover §8.4
Fase 7  TULIS #2 — ambil kontrak & submit hasil
Fase 8  Verifikasi, juri, jalur pemulihan
Fase 9  Polling & keadaan hidup
Fase 10 Pengerasan: CSP, build, mobile, a11y
```

---

# Fase 0 — Fondasi & pagar memori

> **Status: selesai 2026-09-24** (kecuali isi gas arbiter — dikirim sendiri oleh tim sebelum Fase 8).
>
> | Isi | Hasil |
> |---|---|
> | `wagmi@3.7.7` + `@tanstack/react-query@5.103.2` | terpasang; viem tetap **satu** salinan (2.56.3); 0 kerentanan |
> | `preloadEntriesOnStart: false` | di `next.config.ts` |
> | `NEXT_PUBLIC_RPC_URL` | ditambahkan ke `.env.local` |
> | `lib/api.ts` | `api<T>()` / `apiPost<T>()` + `ApiClientError` (`NETWORK`, `BAD_RESPONSE`, atau kode server) — 10 uji |
> | Baseline & sesudah | uji murni 80 → **139**, total **235**; keamanan 22/22; build lolos |
>
> **Catatan untuk Fase 5: yang terpasang wagmi v3, bukan v2.** Sebagian besar contoh di
> internet memakai API v2. Fase 5 wajib membaca dokumentasi wagmi v3 lebih dulu — aturan
> yang sama dengan Next.js 16 di AGENTS.md.
>
> **Ditemukan & diperbaiki: `.env.local` tidak diabaikan git.** Ada perubahan belum-di-commit
> di `.gitignore` yang mengganti `.env*` menjadi `*.env`. Pola kedua hanya menangkap berkas
> yang *diakhiri* `.env`, jadi `.env.local` — berisi `ORACLE_PRIVATE_KEY` dan
> `SUPABASE_SERVICE_ROLE_KEY` — akan ikut ter-commit oleh `git add .`. Belum pernah masuk
> commit mana pun. `.env*` dikembalikan, `*.env` dipertahankan, ditambah `!.env.example`.
>
> **Peringatan `allowScripts` untuk esbuild** saat instalasi hanya pemberitahuan: versinya
> tidak berubah (0.28.2), binernya berfungsi, `tsx` jalan. Tidak ada skrip yang diizinkan.

**Tujuan.** Memastikan mesin ini sanggup, sebelum satu baris UI ditulis.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| Ada fase nol yang tidak menghasilkan UI | `handover §5` mencatat dev server **pernah OOM** (`memory allocation of 16777216 bytes failed`). Kalau itu kambuh di tengah Fase 6, Anda akan mengira `/create` yang salah |
| `experimental.preloadEntriesOnStart: false` di `next.config.ts` | Next.js memuat modul **setiap halaman** ke memori saat server start. Dengan 8 rute + wagmi, itu jejak awal yang tidak perlu di RAM 3,88 GB. Sumber: `node_modules/next/dist/docs/01-app/02-guides/memory-usage.md` |
| **Tidak** memakai `experimental.webpackMemoryOptimizations` | Next.js 16 memakai **Turbopack secara default** (`upgrading/version-16.md:126`). Opsi itu khusus Webpack — memasangnya cuma menambah baris yang tidak berefek |
| `npx next typegen` dijalankan dan hasilnya dipakai | `layout.tsx:20` sudah memakai `LayoutProps<"/">`, jadi typegen memang sudah dipakai di repo ini. Halaman baru harus konsisten memakai `PageProps<'/jobs/[id]'>` |

### Isi

1. `npm install wagmi @tanstack/react-query` — **dua** paket. `viem` sudah ada
   (`package.json`), `@rainbow-me/rainbowkit` **tidak** dipasang (keputusan #1).
2. `next.config.ts`: tambah `experimental: { preloadEntriesOnStart: false }`.
   Jangan sentuh blok `headers()` — itu sudah benar dan sudah diuji
   `npm run check:security`.
3. Tambah **satu** baris ke `.env.local` (nilai publik, bukan rahasia):
   ```bash
   NEXT_PUBLIC_RPC_URL=https://bsc-testnet-rpc.publicnode.com
   ```
   **Kenapa hanya satu, bukan dua.** Rancangan pertama saya menyebut
   `NEXT_PUBLIC_CHAIN_ID=97` juga — itu berlebihan. `viem` sudah membawa
   `bscTestnet` lengkap dengan `id: 97`, jadi penjaga jaringan di Fase 5 cukup
   membandingkan dengan `bscTestnet.id`. Angka yang diimpor tidak bisa melenceng
   dari konfigurasi chain; angka yang diketik ulang di env bisa.

   **Kenapa tidak memakai `RPC_URL` yang sudah ada:** tanpa prefiks
   `NEXT_PUBLIC_`, nilainya tidak sampai ke browser — dan itu memang disengaja.

   **Kenapa RPC-nya tidak ikut diimpor dari viem:** `bscTestnet` punya RPC
   bawaan, tapi yang publik gratis sering kena rate limit. `handover §6` sudah
   menunjuk publicnode sebagai yang dipakai dan terverifikasi; itu yang dipakai.

   `contractAddress`, `arbiter`, `bondBps`, `structuralBps` **tetap** dibaca dari
   `GET /api/chain-info`, tidak diduplikasi ke env — supaya tidak ada dua sumber
   kebenaran.

   > `NEXT_PUBLIC_*` disisipkan saat **build**, bukan dibaca saat jalan. Kalau
   > nanti di-deploy, variabel ini harus ada di Vercel **sebelum** build —
   > menambahkannya setelah deploy tidak berefek sampai build berikutnya.
4. `lib/api.ts` — satu fungsi `api<T>()` yang membungkus amplop
   `{ok:true,...}` / `{ok:false,code,error}` (`lib/http.ts:35-44`) jadi
   `Promise<T>` atau lempar `ApiClientError` yang membawa `code`. **Ini
   satu-satunya tempat di FE yang tahu bentuk amplop itu.**
5. Jalankan `npx tsx scripts/dev-roles.ts` sekali untuk mencatat titik awal
   saldo gas. Satu-satunya tindakan yang tersisa: **kirim 0,001 tBNB dari owner
   ke arbiter** (§A17). Tidak memblokir Fase 1–7.

### Cara verifikasi

```bash
npm run check          # 176 uji murni — harus tetap hijau setelah npm install
npm run check:security # 22 pemeriksaan — memastikan header tidak tergeser
npx next typegen       # harus selesai tanpa error
npm run dev            # biarkan hidup 2 menit
```

Sambil `npm run dev` hidup, di terminal kedua:

```bash
# Windows PowerShell — pantau jejak memori proses node
Get-Process node | Select-Object Id, @{n='RAM_MB';e={[int]($_.WS/1MB)}}
```

**Lolos kalau:** `npm run check` tetap 176 hijau, `/docs` terbuka, dan tidak ada
proses node yang melewati ~900 MB saat idle. Kalau melewati, hentikan di sini dan
naikkan `NODE_OPTIONS=--max-old-space-size=1536` sebelum lanjut — jangan lanjut
dengan harapan.

---

# Fase 1 — Redesign: mockup HTML statis

> **Status: selesai 2026-09-24** → [`design/geo-escrow-redesign.html`](design/geo-escrow-redesign.html).
> Diverifikasi: 17 rute ter-render, tangkapan layar di 1440/900/390px, dan
> 33/33 uji alur interaktif lulus tanpa error JavaScript. Tinggal persetujuan
> selera Anda sebelum Fase 2 mengunci tokennya.

**Tujuan.** Mengunci bahasa visual **sebelum** ada React, supaya revisi selera
berharga detik, bukan satu siklus `next dev`.

**Keluaran:** satu berkas `design/geo-escrow-redesign.html` — dibuka langsung di
browser, nol build, nol risiko OOM.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| Shadow keras `5px 5px 0` → `0 1px 2px rgba(20,22,26,.05)` | Offset shadow hitam pekat adalah penanda gaya paling kuat di prototipe, dan yang paling dibaca sebagai "template", bukan "produk" |
| Border `3px`/`4px` → `1px` hairline | Border tebal memaksa semua elemen punya bobot visual yang sama. Hierarki jadi rata, mata tidak tahu harus ke mana |
| `--radius: 0` → `8px` kartu / `6px` kontrol | Sudut siku-siku murni adalah bagian dari kosakata brutalis |
| Archivo Black **dibuang** | Semua-kapital + weight 900 untuk setiap `h1 h2 h3` membuat tiap heading berteriak sama kencang. Hierarki dibangun ulang lewat ukuran + tracking + warna |
| Tiga keluarga font → **dua** | `Inter` (UI + heading) + `JetBrains Mono` (angka, alamat, hash). Mono dipertahankan karena **fungsional**: `0x71c7…8976` wajib lebar-tetap supaya bisa dibandingkan sekilas. Bonus: satu unduhan font lebih sedikit |
| Badge status: isian solid → **tinted** (bg lembut + teks pekat + border senada) | Ini yang paling menentukan kesan "fintech". Badge solid neon di 13 status membuat halaman list terlihat seperti papan lampu |
| Latar `#FFF7E3` krem → `#F8F8F6` | Krem kuat menggeser persepsi seluruh warna di atasnya. `#F8F8F6` menyisakan sedikit kehangatan supaya tidak jadi abu-abu korporat |
| **Dark mode tidak dikerjakan** | Bukan karena sulit — karena belum ada yang memintanya, dan 13 badge × 2 tema = 26 kombinasi yang harus diuji. Token disusun supaya bisa ditambahkan nanti tanpa membongkar |

### Palet — identitas hue dipertahankan, porsi diturunkan

> **Revisi 2026-09-24 — tabel di bawah sudah usang untuk dua baris.** Setelah
> ditinjau, warnanya terasa kurang. Penyebabnya dua, dan dua-duanya diperbaiki:
>
> 1. **Warna merek nyaris tidak muncul.** Satu token `--chain` dipakai untuk merek
>    *dan* status sekaligus. Sekarang dipisah: `--primary`/`--accent`/`--mark` untuk
>    merek (berganti antar palet), `--chain` hanya untuk status aktif (`st-violet`,
>    `note-info`). Merek diberi tempat tetap: nav aktif, kartu "Terkunci di
>    kontrak", chip ikon judul kartu, garis tab, titik timeline aktif, logo, inti radar.
> 2. **`#2947C4` condong ke indigo** (hue ~228°) — tetangga ungu. Status aktif
>    kini biru murni `#2459B3` (~218°).
>
> Empat palet merek bisa dibandingkan langsung di mockup (Mode tinjau → Palet
> warna, atau `?palette=`). Semua lolos kontras AA untuk tombol, nav aktif,
> tautan, dan badge status. Uji di halaman detail menemukan dua yang bertabrakan
> dengan warna status: **Tinta & Emas** (aksen emas = badge "Zona abu") dan
> **Terakota** (titik "langkah aktif" = titik "langkah gagal"). **Rekomendasi:
> Samudra** (`--primary #0E6B73`). **Menunggu pilihan Anda sebelum Fase 2.**
>
> Ikut diperbaiki: `--faint` `#8C939C` → `#6B727B` dan `--muted` `#5A616B` →
> `#4F565F`. Nilai lama cuma 2,9:1 di kanvas — gagal WCAG, padahal dipakai
> untuk info penting (batas ambil, waktu, keterangan statistik). Sekarang 4,6:1
> dan 7,0:1.

| Peran | Prototipe | Redesign | Dipakai untuk |
|---|---|---|---|
| `--paper` | `#FFF7E3` | `#F8F8F6` | kanvas |
| `--card` | `#FFFFFF` | `#FFFFFF` | permukaan |
| `--ink` | `#0D0D0D` | `#16181D` | teks utama |
| `--muted` | `#4A4A46` | `#5A616B` | teks sekunder |
| `--faint` | `#8A8578` | `#8C939C` | label |
| `--line` | — | `#E4E7EA` | hairline (**baru**) |
| `--chain` | `#3D5AFE` | `#2947C4` | aksi utama, "on-chain" |
| `--verify` | `#B6FF3C` | `#1B6B36` | berhasil, "disebut" |
| `--signal` | `#FF7A1A` | `#B5590C` | sedang berjalan |
| `--warn` | `#FFD60A` | `#8A6A05` | zona abu, perlu juri |
| `--danger` | `#FF3B3B` | `#A5262F` | gagal, refund |

Badge (bg / teks / border):

```
st-mint    #ECF6EF  #1B6B36  #C2E0CE
st-violet  #EEF1FC  #2947C4  #C9D3F5
st-amber   #FDF3E7  #B5590C  #F0D5B4
st-warn    #FCF7E6  #8A6A05  #EBDCA8
st-rose    #FCEEEF  #A5262F  #F0C9CC
```

### Aturan tulisan & angka (revisi 2026-09-24 — "masih kurang profesional")

Sumber rasa "amatir" ternyata bukan warna. Empat hal, dan keempatnya **wajib dijaga
di Fase 2–10**, karena semua teks ini akan ditulis ulang di React:

| Aturan | Sebelum | Sesudah |
|---|---|---|
| **Nama fungsi, endpoint, dan env var tidak muncul di layar pengguna.** Tempatnya di komentar kode, tooltip, atau panel audit | `saldo native dari useBalance()` · `dibaca lewat /api/chain-info` · `createJob · budget masuk kontrak` | `MetaMask · BNB Smart Chain Testnet` · (dihapus) · `Budget 0.004 tBNB dikunci` |
| **Tulis hasilnya, bukan cara kerjanya.** Timeline menampilkan angka sungguhan dari job itu | `acceptJob · bond 5% dikunci` | `Bond 0.0002 tBNB dikunci · 0xF77e…0a04` |
| **Uang pakai font biasa + angka tabular; satuan diredam.** Mono hanya untuk alamat, hash, dan id teknis | `0.005 tBNB` dalam mono | `0.005` + `tBNB` abu-abu — komponen `money()` |
| **Error sistem mentah disembunyikan di balik "Detail teknis".** Kalimat utamanya bahasa manusia | `Server membalas INTERNAL` | `Terjadi gangguan di server kami. Dana Anda di kontrak tidak terpengaruh.` |

Alasan penolakan konten (`Konten harus menyebut nama brand…`) **tetap terlihat** —
itu kalimat yang memang ditujukan ke freelancer, bukan detail teknis.

Ikut dicabut: chip ikon berwarna di tiap judul kartu (pola template generik) dan
subjudul halaman yang menjelaskan konsep produk. Diukur: istilah developer di
layar 13 → 0, pemakaian mono 38 → 23 (7 di antaranya di halaman Sistem desain, yang memang untuk developer; sisanya alamat, hash, dan id teknis).

### Gaya premium (revisi 2026-09-24 — "terlalu basic, kurang menjual")

Lapisan di atas gaya minimal; tata letak tidak bergeser. Bisa dibandingkan di
Mode tinjau → Gaya, atau `?style=minimal`.

| Elemen | Isinya |
|---|---|
| Latar | Cahaya warna merek di atas halaman + pola titik yang memudar |
| Sidebar | Gelap (`--mark`) di desktop & tablet; tab bar ponsel tetap terang |
| Kartu hero | "Terkunci di kontrak" bergradien gelap + grafik tren 21 hari + selisih 7 hari |
| Kartu wallet | Dana atas nama Anda yang masih terkunci + yang sudah diterima |
| Logo inisial | Per brand, hue dari set terkurasi **tanpa ungu** |
| Huruf | **Plus Jakarta Sans** (dirancang di Jakarta) menggantikan Inter |

Konsekuensi untuk fase berikutnya:

- **Fase 2** memuat `Plus_Jakarta_Sans` lewat `next/font/google`, bukan `Inter`.
  Tracking badan teks **0** — tracking negatif ala Inter membuat spasi antarkata
  Plus Jakarta Sans nyaris hilang (sudah terjadi di mockup, sudah diperbaiki).
- **Fase 3**: grafik tren dan angka kartu wallet dihitung dari `GET /api/activity`
  — endpoint yang **sudah ada**, tanpa perubahan bentuk. Batasnya 150 baris
  terbaru (`lib/jobs-repo.ts` `getActivity`); cukup untuk skala demo. Kalau
  aktivitas melewati itu, grafiknya akan terpotong di ujung lama — dicatat, bukan
  diperbaiki sekarang. `Number()` hanya dipakai untuk **menggambar** grafik;
  angka yang ditampilkan tetap BigInt.

### Isi mockup

Semua **13** status, bukan 10 — termasuk tiga yang tidak punya gambar (§A2).
Halaman yang digambar: Ringkasan · Pasar · Buat · Detail (empat varian status:
`open`, `in_progress`, `dispute`, `settled_release`) · Log Oracle · Aktivitas ·
modal wallet · `<TxButton>` di keempat keadaan (§A13) · panel verdict (§A12) ·
keadaan kosong & keadaan gagal.

### Cara verifikasi

```powershell
start design\geo-escrow-redesign.html
```

Lalu, di jendela yang sama:

1. Kecilkan lebar ke **390px** (DevTools → responsive). Sidebar harus jadi bottom
   tab bar, tidak ada scroll horizontal di seluruh halaman.
2. Lebarkan ke **900px**. Sidebar jadi rail ikon.
3. `Ctrl+F` di sumbernya: cari `#B6FF3C`, `#FFF7E3`, `5px 5px 0`, `Archivo`.
   Keempatnya harus **nol hasil** — kalau masih ada, ada bagian yang belum
   dikonversi.
4. Buka DevTools → **Rendering → Emulate vision deficiencies →
   Achromatopsia**. Badge `st-mint` dan `st-rose` harus masih bisa dibedakan.
   Kalau tidak, ikon/teksnya yang kurang, bukan warnanya.

**Lolos kalau:** Anda melihatnya dan tidak ingin mengubah apa pun yang bersifat
selera. Fase 2 mengunci angka-angka ini jadi token; mengubahnya setelah itu jauh
lebih mahal.

---

# Fase 2 — Token, shell, rute kosong

> **Status: selesai 2026-09-24.** Palet Samudra + gaya Premium dikunci sebagai
> nilai tetap di `app/globals.css` (tanpa pengalih). Hasil verifikasi:
>
> | Pemeriksaan | Hasil |
> |---|---|
> | `next typegen` · `tsc --noEmit` · `npm run lint` | bersih |
> | 7 rute + `/jobs/0` | 200 |
> | `/jobs/abc` · `/jobs/0x10` · `/jobs/1e1` · `/jobs/9007199254740993` · URL asing | 404 |
> | Font dari Google di HTML | 0 — dua `.woff2` dari `/_next/static/media/` |
> | `lang` · judul tab | `id` · `Kontrak #0 · GEO Escrow` |
> | `npm run build` | lolos; RAM bebas terendah **308 MB** |
> | `npm run check` · `check:security` | 176/176 · 22/22 — sama dengan baseline |
> | `openapi.json` dihasilkan ulang | identik byte-per-byte |
>
> **Penyesuaian dari rencana:** kelas komponen mockup dipindah ke `@layer components`
> di `globals.css`, bukan ditulis ulang jadi utilitas Tailwind per elemen — supaya
> tampilannya setia 1:1 dengan mockup yang disetujui. Token tetap tersedia sebagai
> utilitas lewat `@theme inline` (`bg-card`, `text-muted`, …).
>
> **Tiga hal yang ditemukan:**
>
> 1. **`parseJobId` di backend lebih longgar dari §A9** — memakai `Number(raw)` +
>    `isInteger`, jadi `/api/jobs/0x10` dibaca job 16, `1e1` job 10, dan angka di atas
>    2^53 lolos dengan presisi hilang. FE memakai `lib/route-params.ts` yang ketat
>    (digit saja + `isSafeInteger`). Memperketat backend **mengubah perilaku endpoint**
>    → tidak disentuh, **menunggu persetujuan** (§D.1 A18).
> 2. **`usePathname()` aman tanpa pola fallback.** Dokumen Next.js 16 memperingatkan
>    hydration mismatch jika halaman dicapai lewat rewrite; `proxy.ts` hanya
>    mencocokkan `/api/:path*` dan tak pernah me-rewrite.
> 3. **Uji viewport ponsel harus satu origin.** `X-Frame-Options: SAMEORIGIN` (dari
>    `next.config.ts`) menolak iframe `file://` — header keamanan bekerja benar.
>    Pembungkus uji diletakkan sementara di `public/` lalu dihapus.
>
> **Risiko untuk Fase 5:** sisa RAM saat build tinggal 308 MB, dan wagmi +
> react-query akan menambah beban kompilasi. Siapkan
> `$env:NODE_OPTIONS='--max-old-space-size=1536'` dan tutup aplikasi lain saat build.

**Tujuan.** Memindahkan hasil Fase 1 ke Next.js, dan membuat seluruh navigasi
bisa diklik — dengan halaman yang masih kosong.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| Token mendarat di `@theme` Tailwind v4, bukan `:root` biasa | Tailwind v4 sudah terpasang dan `app/globals.css:1` sudah `@import "tailwindcss"`. `@theme` membuat token otomatis jadi utilitas (`bg-paper`, `text-ink`) — tanpa `tailwind.config.js` sama sekali (dokumen `01-getting-started/11-css.md`) |
| Font lewat `next/font/google`, bukan `<link>` ke fonts.googleapis.com | Prototipe memakai `<link>`. `next/font` mengunduh saat build dan self-host — satu permintaan jaringan pihak ketiga lebih sedikit, dan tidak ada FOUT. `layout.tsx` sudah memakai polanya (`Geist`), tinggal ganti keluarganya |
| Sidebar + topbar hidup di `app/layout.tsx`, bukan diulang tiap halaman | Prototipe me-render ulang seluruh shell tiap `render()`. Di App Router, layout **tidak** ikut di-render ulang saat navigasi antar halaman |
| Shell adalah Client Component, halaman tetap Server Component sebisanya | Sidebar butuh `usePathname()` untuk menandai nav aktif. Menaikkan `'use client'` ke layout akan menyeret seluruh pohon jadi client. Yang benar: `<Shell>` client kecil, `children` tetap server |
| Nav "Kontrak saya" → `/my-jobs` | Ikut `Ringkasan §1.4`. Prototipe memakai rute internal `mine` |
| `data-scroll-behavior="smooth"` **tidak** dipasang | Next.js 16 berhenti menimpa `scroll-behavior` (`upgrading/version-16.md:961`). Kita memang tidak memakai smooth scroll global, jadi perilaku baru justru yang diinginkan — tidak ada yang perlu ditambahkan |

### Isi

```
app/
  layout.tsx          ← ganti metadata + font, pasang <Shell>
  globals.css         ← @theme dengan token Fase 1
  page.tsx            ← Ringkasan (kosong)
  market/page.tsx
  create/page.tsx
  my-jobs/page.tsx
  jobs/[id]/page.tsx
  oracle-log/page.tsx
  activity/page.tsx
components/
  shell/Shell.tsx     ← 'use client' — sidebar + topbar + nav aktif
  ui/                 ← Badge, Card, Button, Empty, Panel, Pill
```

`metadata` diganti dari `"Create Next App"` jadi judul sungguhan (§A15).

### Cara verifikasi

```bash
npm run dev
npm run lint
npm run build        # jalankan SEKALI di fase ini, bukan tiap perubahan
```

1. Klik ketujuh item nav berurutan. URL berubah, item aktif ikut berpindah,
   sidebar **tidak berkedip** saat navigasi (bukti layout tidak re-render).
2. Buka `/jobs/0`. Harus memuat halaman kosong, **bukan** 404 dan bukan redirect
   (§A9).
3. DevTools → Network → filter `Font`. Semua font berasal dari origin sendiri
   (`/_next/static/media/...`), **tidak ada** permintaan ke `fonts.gstatic.com`.
4. `npm run build` selesai tanpa error tipe. Kalau `PageProps` belum dikenal,
   jalankan `npx next typegen` lalu ulangi.

---

# Fase 3 — Halaman baca-saja

> **Status: selesai 2026-09-24**, termasuk `npm run build`.
> Ringkasan, Pasar, Log Oracle, Aktivitas membaca data sungguhan lewat react-query;
> Kontrak saya menampilkan ajakan hubungkan wallet (daftarnya butuh alamat — Fase 5).
>
> | Pemeriksaan | Hasil |
> |---|---|
> | Uji murni + oracle + input | **274** (167 + 47 + 60), semua lolos |
> | Keamanan · tipe · lint | 22/22 · bersih · bersih |
> | 8 halaman di Chrome sungguhan | **0 error konsol** (penangkap dibuktikan bekerja dengan error sengaja) |
> | Hitungan tab Pasar vs data | 8 · 4 · 2 · 1 · 1 — cocok dengan `MARKET_FILTERS` |
> | Sorotan brand FE vs `run.hit` server | **35/35** baris konsisten |
> | Kode server di bundle klien | tidak ada (SDK Anthropic, kunci, `lib/db`, `lib/indexer`) |
> | `openapi.json` | identik — tidak ada endpoint yang berubah |
>
> **Keputusan yang diambil di fase ini:**
>
> 1. **"Terkunci di kontrak" dihitung dari ledger aktivitas** (`lib/ledger.ts`), bukan dari
>    tabel jobs. Diuji per job terhadap data dev: setiap job yang tercatat cocok sampai ke wei.
>    Ledger memberi 0,121 tBNB; tabel jobs 0,161 — selisihnya job #910/#911 yang dibuat saat
>    chain mati dan **tidak ada di blockchain**. Angka tidak ditampilkan (—) kalau ledger
>    terpotong di 300 baris atau ada tipe tak dikenal: angka salah lebih buruk dari tanda —.
> 2. **Pagar anti-penyimpangan:** `check-pure.ts` membaca union `ActivityType` langsung dari
>    `lib/indexer.ts` dan gagal kalau ada tipe yang tidak terklasifikasi masuk/keluar/netral.
> 3. **Dua ekstraksi murni lagi dari backend** (perilaku identik, impor lama tetap jalan):
>    `lib/brand-match.ts` (`textHitsBrand` + `splitByBrand`, satu pembuat pola) dan
>    `lib/oracle/engines.ts` (label engine). Keduanya sebelumnya tinggal di modul yang
>    mengimpor `@anthropic-ai/sdk`. Mockup Fase 1 ternyata mewarisi bug lama `\b` di dua
>    sisi — ekstraksi ini mencegahnya terulang di FE.
> 4. **`useNow()`** (`lib/use-now.ts`, `useSyncExternalStore`) menggantikan `Date.now()` di
>    render — lint `react-hooks/purity` menangkapnya, dan di server nilainya berbeda dengan
>    browser (hydration mismatch). `null` di server & saat hydration.
> 5. **`keepPreviousData` dibuang** dari daftar job: di Pasar itu menampilkan kartu tab lama
>    sesaat di bawah label tab baru.
> 6. **Label engine dari data** (`engineLabel()`): dev memakai `mock-a` → "Mock A",
>    bukan nama Claude yang dikodekan keras.
>
> **Bug yang ditemukan & diperbaiki:** `formatTime()` mencetak teks "Invalid Date" untuk
> tanggal rusak (`new Date('x')` tidak melempar, jadi `try/catch`-nya tak pernah terpicu);
> kolom angka tabel Aktivitas rata kiri (spesifisitas CSS); kolom Log Oracle tidak sejajar;
> regex uji rusak oleh heredoc Git Bash (`[\s\S]` jadi `[sS]`) — persis peringatan handover §5.
>
> **Bug backend ditemukan & diperbaiki (disetujui — §D.1 A20):** `GET /api/jobs?page=99`
> dulu membalas **500** `"Requested range not satisfiable"`. Diukur terhadap Supabase: offset
> yang TEPAT sama dengan jumlah baris masih sukses (206); hanya yang melewatinya gagal
> (`PGRST103`, tanpa `count`). Sekarang 200 dengan daftar kosong dan total yang benar.
>
> **Kebocoran pesan error mentah (§D.1 A21):** 22 lokasi meneruskan pesan asli Supabase/viem/SDK
> ke respons atau ke `last_error`. Diganti `internalError()` / `publicErrorMessage()`; dijaga
> guard statis di `check:security`.
>
> **Dicatat, bukan bug:** `/api/activity` tidak punya `?page=` (Ringkasan §1.7 keliru);
> job dev #2 "Mengukur baseline…" padahal `idle` — artefak seed, tidak bisa terjadi di
> produksi (job selalu mulai `queued_baseline`, gagal → `error`); sisi kontrak di kolom
> Aliran tampil "—" karena seed menulis `null` — indexer sungguhan selalu mengisinya.
>
> **`npm run build` lolos** (setelah dev server dihentikan). RAM bebas terendah 282 MB —
> VS Code (~1,1 GB) dan Chrome (~630 MB) memakan sisanya; tutup keduanya sebelum build Fase 5.
> `/market` dan `/oracle-log` kini dinamis (membaca `searchParams`); 4 halaman lain tetap
> prerender statis. Bundle klien produksi (16 berkas, 963 KB) dipindai: **0** jejak
> `anthropic`, kunci, `service_role`, atau URL Supabase.

**Tujuan.** Empat halaman list hidup dengan data sungguhan, **sebelum** wallet
masuk ke gambar.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| Wallet dikerjakan **setelah** halaman baca, bukan sebelum | Semua halaman ini punya bentuk tanpa wallet (`?wallet=` opsional; `GET /api/stats` mengembalikan nol untuk tiga dari empat angka). Menunda wallet memisahkan "salah baca data" dari "salah koneksi wallet" |
| Fetching pakai `useQuery` dari react-query | Sudah wajib terpasang untuk wagmi (keputusan #1). Memakainya berarti cache, dedup, dan `refetchInterval` untuk Fase 9 datang gratis — tidak perlu menulis lapisan cache sendiri |
| `deriveUiStatus(job)` diimpor dari `lib/status.ts` | `Ringkasan §1.9` — jangan pernah membaca `job.status` mentah. 13 status UI adalah **turunan**, bukan kolom |
| Data seed dipakai sebagai alat uji resmi fase ini | `POST /api/dev/seed` sengaja mencakup banyak status berbeda supaya tiap cabang `deriveUiStatus()` dan tiap filter pasar bisa diuji tanpa AI + blockchain (komentar di `app/api/dev/seed/route.ts:8-13`) |
| Halaman Log Oracle membaca `run.jobs.brand` | Endpoint global memakai `select('*, jobs(brand)')` (`app/api/oracle-log/route.ts:26`) — brand datang **nested**, bukan sebagai kolom datar. Salah baca di sini menghasilkan `undefined` diam-diam |
| Tombol "Reset demo" dibuang dari topbar | §A14 — tidak ada endpoint reset |

### Isi

| Halaman | Endpoint | Catatan |
|---|---|---|
| `/` | `GET /api/stats` + `GET /api/jobs?limit=3` | Kartu vault **belum** diisi (butuh wallet lib — Fase 5, §A5) |
| `/market` | `GET /api/jobs?filter=…` | `?filter=`, **bukan** `?status=`. Nilai sah dari `MARKET_FILTERS` |
| `/my-jobs` | — | Keadaan "hubungkan wallet dulu" saja di fase ini |
| `/oracle-log` | `GET /api/oracle-log?limit=150` | Label engine `Claude (ringkas)`/`Claude (naratif)` (§A14) |
| `/activity` | `GET /api/activity` | `amount_wei` lewat `formatTBNB()`, **tidak pernah** `Number()` |

### Cara verifikasi

```bash
npm run dev
```

```powershell
Invoke-RestMethod -Method POST http://localhost:3000/api/dev/seed
```

1. `/market` → klik kelima tab. Bandingkan jumlah kartu tiap tab dengan hasil
   `curl "http://localhost:3000/api/jobs?filter=progress"` dkk. Tab **Berjalan**
   harus memuat job ber-status `Accepted`, `Submitted`, **dan** `Verifying`
   sekaligus — kalau cuma satu, `?filter=` tidak sampai ke server.
2. `/activity` → cari baris dengan `amount_wei` terbesar di seed. Nilai yang
   tampil harus **persis** sama dengan `formatTBNB(wei)` di Node:
   ```bash
   npx tsx -e "import{formatTBNB}from'./lib/format';console.log(formatTBNB('20000000000000000'))"
   ```
   Beda satu digit terakhir = ada `Number()` yang menyelinap (§handover 3.4).
3. `/oracle-log` → tiap baris menampilkan **nama brand**, bukan kosong (bukti
   `run.jobs.brand` dibaca benar).
4. Matikan dev server, muat ulang halaman. Harus muncul keadaan error yang
   terbaca, **bukan** spinner selamanya.

---

# Fase 4 — Halaman detail (baca-saja)

> **Status: selesai 2026-09-24.** `/jobs/[id]` → `components/job/` (JobDetailView, DetailCards,
> RadarCard, VerdictCard) + logika murni `lib/job-view.ts` (diuji 83 kasus di `check-pure`).
>
> **Menyimpang dari rencana (dengan alasan):**
> - Tab Log Oracle memakai `runs` dari `?include=runs,activity`, **bukan** request ke
>   `/api/jobs/:id/oracle-log` — keduanya memanggil `getRuns()` yang sama, request kedua mubazir.
> - Audit verdict **dihitung ulang di browser** (subset dari seed, hit vs log AI, keputusan,
>   keccak256), server hanya dimintai hash on-chain. "Server bilang lolos" bukan bukti; hitung
>   sendiri adalah bukti. Kalau hasil browser ≠ `audit.allChecksPassed`, kartu menyebutnya.
>   Konsekuensi: `viem` (keccak256) masuk bundle klien — akan masuk juga lewat wagmi di Fase 5.
> - "Masih di kontrak" dari `ledgerBalance(activity)`, bukan kolom `jobs` (keputusan Fase 3).
>   Tanpa event on-chain → "—" + penjelasan, bukan angka tebakan.
> - Kartu "Ambil kontrak" tanpa angka bond (§A10: `requiredBond()` baru terbaca di Fase 7).
> - Status gagal/macet tampil sebagai catatan; tombolnya datang bersama `<TxButton>` (Fase 5–8).
>
> **Penjaga §A11 terpasang** (`phaseHits`): engine di log < yang dipakai server → semua
> "belum lengkap"; > (sisa provider lain) → "ambigu", tidak ditampilkan.
>
> **Temuan saat verifikasi:** seed #5 menyimpan skor 2/3 (target 3/5) sebagai `dispute`, padahal
> `decide()` = `release` (10 ≥ 9). Kartu juri kini memeriksa ulang dan memperingatkan, alih-alih
> menulis "jatuh di antara batas". Seed #4 `Accepted` tapi punya verdict, #6 settle tanpa
> `verdict_json` — keduanya artefak seed; UI menampilkannya apa adanya dengan penjelasan.
> Bonus: `.faint`/`.muted` dipakai `ActivityView` sejak Fase 3 tapi tak pernah didefinisikan —
> kini ada. `SCAN` yang tersalin 2× dipindah ke `lib/explorer.ts`.
>
> **Belum:** polling (Fase 9 — cukup tambah `refetchInterval` di `useJob`). Status tanpa data
> seed (`baseline_failed`, `structural_failed`, `verifying`, `jury_*`, reclaim, macet)
> diuji lewat fungsi murni, belum dilihat di layar.

**Tujuan.** `/jobs/[id]` lengkap dan benar, masih tanpa satu pun tombol tulis.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| `const { id } = await params` — `params` adalah **Promise** | Next.js 16 menghapus akses sinkron sepenuhnya (`upgrading/version-16.md:281`). Route API di repo ini sudah memakai polanya (`app/api/jobs/[id]/route.ts:17`); halaman harus konsisten |
| Satu request `?include=runs,activity`, bukan tiga | `Ringkasan §1.5` — menghemat dua request untuk satu halaman |
| Radar menggabungkan `oracle_runs` lewat `hitPerQuery()` yang diekstrak ke `lib/scoring.ts` (**butuh persetujuan**, lihat §A11) | §A11. Aturannya sekarang terkunci di `runner.ts` yang server-only. Menyalin `every()` berisiko radar dan verdict menampilkan angka berbeda |
| Timeline punya **7** langkah, bukan 6 | Prototipe: `Dibuat → Baseline → Diambil → Submit → Verifikasi → Settlement`. Ada satu keadaan yang hilang di antara Submit dan Verifikasi: **cek struktural di backend** (`submitted_pending`). Di prototipe itu instan; di sini itu perjalanan ke Oracle lalu ke kontrak |
| Panel verdict digambar sekarang, bukan nanti | §A12 — ini layar yang membuktikan klaim utama produk |
| Tab Log Oracle memakai `GET /api/jobs/:id/oracle-log` | Endpoint **berbeda** dari halaman global. `Ringkasan §1.6` — dua endpoint, bukan satu |

### Isi

Kiri: timeline (7 langkah) · query pool dengan titik baseline/verifikasi ·
deliverable · keadaan gagal + `last_error`.
Kanan: ledger escrow · radar sitasi · panel verdict + `audit.allChecksPassed`.
Tab: Log Oracle per job.

### Cara verifikasi

```bash
npm run dev
```

1. Buka `/jobs/N` untuk **setiap** job hasil seed. Bandingkan badge status di
   layar dengan hasil hitungan langsung:
   ```bash
   npx tsx -e "import{deriveUiStatus}from'./lib/status';console.log(deriveUiStatus({status:'Verifying',job_state:'idle',baseline_score:2,settled_by:null}))"
   ```
   → harus `awaiting_verify`. Ulangi untuk `job_state:'running_verify'` →
   `verifying`.
2. Buka `/jobs/0`. Harus memuat atau menampilkan "tidak ditemukan" yang rapi —
   **bukan** halaman kosong tanpa penjelasan (§A9).
3. Job dengan `multi_engine=true`: hitung manual berapa baris `oracle_runs` yang
   `hit=true` per `query_index`, lalu bandingkan dengan titik di radar. Query
   dengan satu engine hit dan satu miss harus tampil **miss** (§A11).
4. Job yang sudah settle → panel verdict menampilkan `hashMatchesStored: true`.
   `hashMatchesChain` boleh `false` selama `CHAIN_ENABLED=false` — itu benar, dan
   UI harus menjelaskannya, bukan menampilkannya sebagai kegagalan.
5. `/jobs/99999` → keadaan "tidak ditemukan", bukan crash.

---

# Fase 5 — Wallet + `<TxButton>`

> **Status: selesai 2026-09-25.** Didahului audit Fase 0–4 (semua `check`, build produksi,
> pindai bundle, smoke test 30 URL di `next start`) — bersih.
>
> **Dibaca dulu dari paket terpasang (wagmi 3.7.7 / @wagmi/core 3.6.5), bukan dari ingatan v2:**
> `useConnection` (bukan `useAccount`), `useConnectors`, hook aksi pakai `mutate`, `connection.chain`
> **undefined** di jaringan asing sementara `chainId` tetap terisi (penjaga membandingkan `chainId`),
> dan `ssr: true` aman untuk EIP-6963 (`hydrate.js` menambahkan wallet yang mengumumkan diri
> sebelum hidrasi).
>
> **Isi:** `lib/wagmi.ts` · `lib/tx.ts` (logika murni) · `components/wallet/*` (modal EIP-6963,
> tombol akun + menu, wallet mini, ChainGuard) · `components/tx/TxButton.tsx` · Ringkasan, Kontrak
> saya, label "Anda: …" di kartu & detail. Provider di `app/providers.tsx` (bukan
> `components/wallet/Providers.tsx` — sudah ada, cukup ditambah `WagmiProvider`).
>
> **Keputusan desain yang perlu diketahui:**
> - `<TxButton>` **menolak mengirim** selama `CHAIN_ENABLED=false`: kontraknya hidup di testnet
>   tapi server tidak mengindeks → dana terkunci tanpa jejak (job yatim, §A7/A8).
> - Urutan: simulasi (revert ketahuan sebelum gas) → tanda tangan → receipt (`status` diperiksa)
>   → `afterReceipt` → `POST /api/sync/:id` (ulang sekali bila `RATE_LIMITED`) → invalidasi cache.
> - Setelah sukses tombol kirim **tidak muncul lagi** — klik kedua `createJob` = budget terkunci dua
>   kali, dan simulasi tidak bisa mencegahnya. Yang boleh diulang hanya langkah sesudah receipt
>   ("Sinkronkan ulang" / "Coba simpan lagi"), dengan receipt yang sama.
> - Receipt belum datang dalam 120 dtk → keadaan `unknown` + "Periksa lagi" (hash sama), **bukan**
>   tombol kirim ulang.
> - Hanya 6 fungsi milik pengguna yang bisa dipanggil (`UserWriteFn`); fungsi Oracle/owner ditolak compiler.
> - "Terkunci di kontrak" = **saldo on-chain kontrak** (§A5). Tren 7 hari dari ledger hanya tampil bila
>   ledger cocok sampai ke wei; kalau tidak, selisihnya disebut (mode dev: data seed).
> - Audit verdict: hash on-chain kini dibaca **browser** langsung (`getJob`), bukan server.
> - Saldo wallet diringkas (`formatTBNBShort`, dipotong ke bawah, nilai penuh di tooltip);
>   nominal kontrak tetap presisi penuh.
>
> **Guard baru `check:security` §8:** `NEXT_PUBLIC_RPC_URL` https, tidak menyalin `RPC_URL` berkunci.
> Temuan saat membuatnya: `RPC_URL` saat ini publicnode **tanpa** kunci — catatan A21 ("URL + kunci")
> dikoreksi.
>
> **Verifikasi:** 310+47+60 uji murni (termasuk klasifikasi error dengan kelas error viem
> sungguhan). Uji browser lewat DevTools Protocol dengan **wallet tiruan EIP-6963** (tanpa transaksi):
> 30/30 — butir 1–4 di bawah + menu/putus + ponsel 390 px; skenario tanpa wallet 4/4 (butir 6).
> **Belum diuji:** butir 5 (MetaMask + Coinbase sungguhan bersamaan) dan jalur kirim `<TxButton>` —
> aksi tulis pertama baru ada di Fase 6, dan butuh `CHAIN_ENABLED=true`.

**Tujuan.** Koneksi wallet, penjaga jaringan, dan satu komponen yang menangani
seluruh siklus hidup transaksi.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| Tanpa RainbowKit | Keputusan #1. Modal 4-wallet di mockup adalah komponen kustom; RainbowKit harus di-theme berat untuk mencapai tampilan itu — bobot dibayar tanpa hasil |
| Layar "Pilih akun" **dibuang** | §A4 — wagmi memberi satu akun aktif; daftar akun milik ekstensi |
| Penemuan wallet lewat **EIP-6963** | Konektor `injected` polos merebutkan satu `window.ethereum`; kalau MetaMask dan Coinbase sama-sama terpasang, yang menang tidak bisa diprediksi. EIP-6963 membuat tiap wallet mengumumkan dirinya — mockup 4-kartu jadi cerminan wallet yang **benar-benar** terpasang |
| Penjaga chain ID 97 dengan banner + tombol pindah jaringan | Tidak ada di prototipe (wallet-nya simulasi). Tanpa ini, tx akan terkirim ke chain yang salah dan gagal dengan pesan yang tidak menyebut jaringan |
| Satu `<TxButton>` untuk kelima aksi tulis | §A13. Kelimanya punya siklus identik: tanda tangan → terkirim → receipt → `POST /api/sync/:id`. Menyalinnya lima kali berarti lima tempat untuk lupa memanggil `sync` |
| `UserRejectedRequestError` **bukan** error | User menutup popup wallet adalah keputusan yang sah. Menampilkannya merah melatih user mengabaikan warna merah |
| `POST /api/sync/:id` dipanggil **di dalam** `<TxButton>` | `handover §4` — dipanggil setelah **tiap** receipt. Menaruhnya di satu tempat membuatnya mustahil terlewat |

### Isi

```
lib/wagmi.ts              ← config: bscTestnet, chainId 97, RPC dari NEXT_PUBLIC_RPC_URL
components/wallet/
  Providers.tsx           ← WagmiProvider + QueryClientProvider ('use client')
  ConnectModal.tsx        ← EIP-6963, tampilan mockup
  ChainGuard.tsx          ← banner + switchChain
components/tx/TxButton.tsx
```

Kartu "Terkunci di kontrak" di `/` diisi sekarang:
`useBalance({ address: contractAddress dari GET /api/chain-info })` (§A5).

### Cara verifikasi

```bash
npm run dev
```

1. Hubungkan MetaMask di BSC Testnet. Alamat + saldo di sidebar harus **sama
   persis** dengan yang ditampilkan ekstensi.
2. **Pindah jaringan ke Ethereum Mainnet di dalam MetaMask** tanpa menyentuh
   halaman. Banner "jaringan salah" harus muncul dalam hitungan detik. Tekan
   tombol pindah → kembali normal.
3. **Ganti akun di dalam MetaMask.** Seluruh UI harus ikut berganti, dan tab
   "Kontrak saya" harus menampilkan kumpulan job yang berbeda — bukti
   `relationToContract` membaca akun aktif, bukan nilai yang di-cache.
4. Muat ulang halaman. Koneksi harus pulih sendiri tanpa membuka modal.
5. Dengan **MetaMask + Coinbase Wallet sama-sama terpasang**: modal harus
   menampilkan keduanya sebagai entri terpisah dan yang diklik yang terbuka
   (bukti EIP-6963 bekerja).
6. Tanpa wallet apa pun terpasang: modal menampilkan ajakan memasang, bukan
   daftar kosong.

---

# Fase 6 — TULIS #1: `/create`

> **Status: selesai & terverifikasi on-chain 2026-09-25.** Job pertama dibuat lewat Rabby →
> **jobId 0** (§A9). Diperiksa terhadap kontrak: hash, client, budget, batas ambil DB == on-chain;
> deposit tercatat lewat sync; baseline 5 run selesai (`mock-a`). Butir 8: brand dirusak satu
> huruf → `400 HASH_MISMATCH`, database tidak berubah.
> Seed & job uji (1–6, 910, 911) sudah dihapus, `CHAIN_ENABLED=true`, `jobCount()` on-chain = 0.
>
> **Isi:** `lib/job-input.ts` (aturan form, MURNI — `LIMITS` dipindah ke sini, `lib/validate-input.ts`
> mengekspor ulang; perilaku backend identik, `check-input` 60/60) · `lib/create-job.ts` (snapshot,
> jobId dari event, POST idempoten, catatan tertunda, §A8) · `components/create/CreateJobView.tsx`.
>
> **Tambahan di luar rencana (dengan alasan):**
> - **Snapshot beku saat klik** — tx & POST (dan percobaan ulangnya) memakai data yang SAMA; hash di
>   chain tidak bisa diubah lagi. Deadline ISO dari detik yang sama (tanpa milidetik) = persis on-chain.
> - **Catatan transaksi tertunda + panel "Lanjutkan penyimpanan"** — tab ditutup setelah tx terkirim
>   tapi sebelum POST = dana terkunci tanpa metadata, job tak punya halaman, `reclaimExpired` tak
>   terjangkau dari UI. Pemulihan memakai hash yang sama, tanpa tx baru.
> - **POST idempoten** — gagal → cek `GET /api/jobs/:id`; ada dengan hash sama = sukses. `RATE_LIMITED` diulang sekali.
> - **Event `JobCreated` diperiksa silang** (kontrak, client, hash, budget) sebelum metadata disimpan.
> - **§A8 dev-path mulai jobId 900000** — dev job ber-id rendah akan bertabrakan dengan job on-chain.
>
> **Temuan backend (dilaporkan, tidak diubah):** baris baru di nama brand lolos `requireText` tapi
> membuat `canonicalQueryPool` melempar Error biasa → **500**, bukan 400. FE mencegahnya.
> `enginesFor(true)` di provider 1-engine juga melempar `OracleError` (→ 500) SETELAH tx — tidak
> terjangkau sekarang (mock & claude sama-sama 2 engine).
>
> **Temuan lingkungan:** dev server sempat membalas **404 untuk semua `/api/*`** dan `/jobs/[id]` —
> cache Turbopack `.next/dev` basi. Hapus folder itu + restart → normal.
>
> **Verifikasi:** 371 uji murni (cermin FE↔`validate-input`, hash server == hash kontrak, jobId 0 dari
> event, penolakan event tak cocok, idempotensi). Browser (wallet tiruan, tanpa tx): 21/21 — termasuk
> **simulasi `createJob` ke kontrak SUNGGUHAN lolos** sampai wallet diminta tanda tangan, batas ambil
> 5 menit ditolak (§A7), panel pemulihan per-wallet, ponsel.

**Tujuan.** Job pertama berhasil dibuat. Ini fase yang dimaksud `handover §8.4`.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| Field **"Batas ambil"** ditambahkan | `handover §4` + `Ringkasan §1.3` — `createJob` mewajibkan `acceptDeadline`; tanpanya transaksi tidak bisa dibentuk |
| Batas ambil minimal **1 jam** dari sekarang, dikunci di input | §A7. `requireFutureDate` membandingkan dengan `Date.now()` **saat POST**, yang terjadi setelah tx. Deadline terlalu dekat = job yatim: ada di chain, tidak ada di DB |
| Satu nilai `Date` dipakai untuk **kedua** panggilan | §A7. `Math.floor(d.getTime()/1000)` → `uint64` untuk `createJob`; `d.toISOString()` → body POST. Dibaca dari input **sekali**, tidak dua kali |
| `queryPoolHash` **diimpor** dari `lib/hash.ts` | `handover §3.1` — beda satu karakter → `HASH_MISMATCH`, dan job-nya sudah terlanjur ada on-chain |
| `jobId` dari `parseEventLogs` atas receipt, bukan nilai balik `createJob` | Nilai balik fungsi `payable` **tidak** tersedia dari receipt transaksi — hanya lewat `simulateContract` (sebelum eksekusi) atau event log (sesudah). Yang otoritatif adalah event `JobCreated.args.jobId` |
| Jalur `jobIdDevSaja()` khusus `CHAIN_ENABLED=false` | §A8 — tanpa ini halaman ini tidak bisa jalan sama sekali di mode yang aktif sekarang |
| Validasi FE **mencerminkan** `lib/validate-input.ts`, tidak menggantikannya | Backend tetap otoritas. Validasi FE ada supaya user tahu sebelum membayar gas, bukan supaya backend boleh percaya |
| Checkbox: **"Wajib lolos di 2 gaya penjawab"** | §A14 + `handover §4`. Klaim "≥2 mesin AI" sudah tidak mungkin jujur — satu provider, dua persona |
| Peringatan "baseline butuh 10–20 detik" dipertahankan | Masih benar. Baseline jalan lewat `after()` setelah respons terkirim (`app/api/jobs/route.ts:181`), jadi job muncul di UI dengan status `baseline_running` |

### Urutan yang dikunci

```
1. hitung  h = queryPoolHash({brand, queries, targetCount, multiEngine})   ← lib/hash.ts
2. hitung  d = Date  (sekali, dari input "Batas ambil")
3. tx      createJob(h, BigInt(Math.floor(d.getTime()/1000))) {value: budgetWei}
4. receipt → parseEventLogs → JobCreated.args.jobId
5. POST    /api/jobs { jobId, clientAddr, brand, brief, queries, targetCount,
                       multiEngine, budgetWei, acceptDeadline: d.toISOString() }
6. POST    /api/sync/:id
7. router.push(`/jobs/${jobId}`)
```

Langkah 3–4 dilewati saat `chainEnabled === false`; `jobId` dari `jobIdDevSaja()`.

### Cara verifikasi

**Jalur A — `CHAIN_ENABLED=false` (mode sekarang):**

1. Isi form → Buat. Tidak ada popup wallet. Diarahkan ke `/jobs/N`.
2. Halaman detail menampilkan `baseline_running`, lalu berubah sendiri jadi
   `open` dalam ~10–20 detik (`ORACLE_PROVIDER=mock` → instan; `claude` → nyata).
3. **Uji hash yang paling penting**, di terminal:
   ```bash
   npx tsx -e "import{queryPoolHash}from'./lib/hash';console.log(queryPoolHash({brand:'Root & Bloom',queries:['a','b','c'],targetCount:2,multiEngine:false}))"
   ```
   Bandingkan dengan `query_pool_hash` di `GET /api/jobs/N`. **Harus identik
   karakter demi karakter.**
4. Isi "Batas ambil" dengan waktu **5 menit** dari sekarang → form harus menolak
   sebelum mengirim apa pun (§A7).

**Jalur B — `CHAIN_ENABLED=true`:**

```bash
npx tsx scripts/dev-chain-read.ts    # 20 pemeriksaan jalur baca — harus hijau dulu
```

5. Ubah `CHAIN_ENABLED=true` di `.env.local`, restart dev server.
6. Buat job. MetaMask harus meminta tanda tangan dengan `value` = budget.
7. Setelah receipt: `jobId` yang didapat harus **`0`** untuk job pertama
   (`handover §6` mencatat `jobCount()` masih 0). Kalau FE melewatinya atau
   menampilkan job kedua sebagai yang pertama, ada `if (!jobId)` yang tersisa
   (§A9).
8. Sengaja rusakkan satu karakter `brand` di body POST → harus ditolak
   `HASH_MISMATCH`, bukan tersimpan.

---

# Fase 7 — TULIS #2: ambil kontrak & submit hasil

> **Status: ✅ SELESAI & TERUJI ON-CHAIN 2026-09-26** (setelah Tahap 0 audit, `geo-escrow-audit-sistem.md`).
> Job 0 oleh freelancer 0xD28f…5F16: `acceptJob` (bond 0,00015, tx 0x6bdad10e…) → periksa konten →
> `submitDeliverable` (hash 0x56643b85…688ccc, 21.59.37) → Oracle `confirmStructural` (tx 0x4c57db7b…,
> 0,0006 = 20% cair) → **DB tersinkron sendiri ke `Verifying` pukul 22.01.46 tanpa cron** (S-01 terbukti).
> Chain = DB: status, hash, `structural_released_wei`, seed, `deliverable_submitted_at`. Seed on-chain
> `0x…02` (konfirmasi S-04). Temuan uji: halaman tidak menyegarkan diri setelah kerja Oracle di latar
> (spinner sampai F5) → polling status berspinner, dikerjakan bersama Fase 8. RPC publicnode sempat
> lambat (±4,7 dtk; Rabby timeout `eth_gasPrice`) — RPC resmi `bsc-testnet.bnbchain.org` ±0,5 dtk.
> `lib/deliverable.ts` (penjaga + pengiriman konten) · `components/job/Actions.tsx` (AcceptCard,
> DeliverableCard) · `WorkCard` memilih kartu dari peran wallet. `lib/structural.ts` kini mengimpor
> `textHitsBrand` langsung dari `lib/brand-match` (fungsi yang sama) → form memakai `checkStructural`
> MILIK SERVER, dan bundle tetap bebas SDK Anthropic (terbukti di build).
>
> **Dikonfirmasi dari bytecode kontrak** (`GeoEscrow.json`): pesan require `GEO: client tidak boleh
> ambil sendiri`, `GEO: nilai bond tidak sesuai`, `GEO: bukan freelancer job ini`, dst.
>
> **Temuan backend — DIPERBAIKI 2026-09-26 (disetujui):** `POST /api/jobs/:id/deliverable` menulis
> `deliverable_hash` ke DB pada kiriman PERTAMA — sebelum ada apa pun di chain — dan endpoint-nya tanpa
> autentikasi. Akibatnya freelancer tak bisa merevisi sebelum tanda tangan, dan siapa pun bisa
> "mengunci" duluan. **Perbaikan:** `lib/deliverable-lock.ts` — konten terkunci ke hash **on-chain**
> (dibaca dari kontrak), bukan kiriman pertama; `deliverable_hash` di DB hanya cermin nilai on-chain.
> Gerbang `confirmStructural` kini juga membaca hash on-chain (dulu `if (job.deliverable_hash && …)`
> dilewati diam-diam bila kolom kosong). Bentuk request/respons **tidak berubah**; chain mati = perilaku
> lama. Tambalan FE (sync → kirim ulang) dicabut. **Revisi: otomatis, bukan dibuka client** — sebelum
> tanda tangan bebas; sesudahnya terkunci; ditolak struktural → kontrak mengembalikan ke `Accepted`.
> Sisa risiko kecil (dicatat): draf sebelum tanda tangan bisa ditimpa orang lain (FE mendahulukan draf
> lokal + kirim ulang setelah receipt), dan rate limit per-job bisa "dihabiskan" pengirim lain.
>
> **Verifikasi:** 394 uji murni (penjaga peran, structural = server, revisi-lewat-sync, rate limit,
> terkunci on-chain). Browser vs kontrak #0 SUNGGUHAN (wallet tiruan, tanpa tx): 8/8 — bond =
> `requiredBond(0)` = 0,00015; client tidak melihat tombol; simulasi `acceptJob` lolos sampai tanda tangan.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| Bond dibaca dari view `requiredBond(jobId)`, **tidak** dihitung | §A10. `acceptJob` menolak `value` yang tidak persis sama; `budget * 0.05` di JS hampir pasti meleset di digit terakhir |
| Angka 5% dan 20% tidak pernah muncul di kode FE | §A10. `bondBps`/`structuralBps` dari `chain-info` hanya untuk **ditampilkan** |
| Deliverable: **POST konten dulu, tanda tangan belakangan** | `handover §3.2` + `Ringkasan §1.5`. Urutan terbalik membuat job nyangkut permanen di `Submitted` tanpa konten kalau tab ditutup di antaranya — Oracle tidak punya apa pun untuk diverifikasi |
| Kegagalan structural ditampilkan **di tempat**, bukan sebagai toast | Backend mengembalikan `STRUCTURAL_FAILED` + pesan spesifik (`app/api/jobs/[id]/deliverable/route.ts:74`). Freelancer perlu membacanya sambil memperbaiki tulisannya — toast hilang sebelum sempat dibaca |
| Tombol "Ambil kontrak" disembunyikan kalau `acc.addr === client_addr` | Sudah benar di prototipe (`canAccept`). Dipertahankan |

### Urutan deliverable yang dikunci

```
1. POST /api/jobs/:id/deliverable { content }  → { deliverableHash, structuralPass, length }
   ↑ structural check jalan DI SINI — freelancer tahu lolos SEBELUM bayar gas
2. tx  submitDeliverable(jobId, deliverableHash)
3. POST /api/sync/:id
   ↑ route ini memanggil confirmStructural() lewat after() — itu yang mencairkan 20%
```

### Cara verifikasi

1. Dengan akun **berbeda** dari client, buka job ber-status `open` → "Ambil
   kontrak". Sebelum tanda tangan, nilai bond yang ditampilkan harus sama dengan:
   ```bash
   npx tsx scripts/dev-chain-read.ts     # cari baris requiredBond
   ```
2. Coba ambil kontrak **milik sendiri** → tombolnya tidak boleh ada.
3. Submit deliverable **yang sengaja gagal** structural (kurang dari 40 karakter,
   atau tidak menyebut brand). Harus: pesan muncul di dalam panel, **tidak ada
   popup wallet**, dan tidak ada gas terpakai.
4. Submit yang lolos → popup wallet muncul membawa hash. Hash di popup harus sama
   dengan `deliverableHash` di respons langkah 1 (DevTools → Network).
5. **Uji jebakan utama:** setelah langkah 1 sukses, **tutup tab** sebelum tanda
   tangan. Buka lagi `/jobs/N`. Konten harus sudah tersimpan dan bisa
   ditandatangani ulang — inilah yang dibeli oleh urutan terbalik itu.
6. Setelah receipt → status jadi `submitted_pending`, lalu `awaiting_verify`
   setelah `confirmStructural` beres. Ledger menunjukkan structural release
   terisi.

---

# Fase 8 — Verifikasi, juri, jalur pemulihan

> **Status: bagian 1 ✅ SELESAI & TERUJI ON-CHAIN 2026-09-26 22.27** — job 0 jalur (a) happy path
> tuntas dari UI: verifikasi → `settleRelease` (tx 0x46c3803e…) → `ReleasedFull`, `settled_by=oracle`,
> 4/4 subset [1,2,3,4] = prediksi. `verdict_hash` DB = chain = keccak dihitung ulang. Ledger job 0 = 0 =
> saldo kontrak on-chain (bukti perbaikan S-16: `final_release` 0,00255 sudah termasuk bond). UI
> berpindah sendiri tanpa F5 (polling).
> Polling `useJob` (Fase 9 dimajukan: hanya status hidup yang tidak macet, atau selama aksi Oracle
> berjalan; 4 dtk; tab tersembunyi berhenti) · `components/job/OracleActions.tsx`: Verifikasi sekarang /
> Coba verifikasi lagi / Lanjutkan verifikasi (macet) · Ukur ulang baseline (gagal atau macet) ·
> Konfirmasi ulang struktural (gagal sistem, macet, atau idle > 2 mnt setelah submit) — hanya untuk
> client & freelancer · `lib/job-view.ts` `oracleOffer`/`verifyOutcome` (diuji) · `lib/status.ts`
> `STALE_LOCK_MS`/`RUNNING_STATES` satu sumber untuk server & FE · route baseline menerima pengukuran
> macet · `lib/invalidate.ts` dipakai TxButton & tombol Oracle. Bentuk respons endpoint tidak berubah.
> **Prediksi job 0 (mock, seed 0x02):** subset [1,2,3,4], hit 4/4, `release` → sisa 0,0024 + bond
> 0,00015 = 0,00255 ke freelancer.
> **Bagian 2 kode selesai 2026-09-26 — menunggu uji on-chain:** `components/admin/ArbiterAdmin.tsx`
> (kartu "Ganti arbiter" di Ringkasan, HANYA wallet owner; owner menandatangani `setArbiter` di wallet —
> kunci owner tidak diekspor) · `lib/admin.ts` `checkNewArbiter` (checksum strict, bukan owner/Oracle/
> arbiter sekarang) · `ArbiterDecision` di JuryCard (dua tombol `arbiterDecide`, hanya wallet arbiter) ·
> `UserWriteFn` + `setArbiter`, dengan pagar uji: fungsi owner berbahaya & fungsi Oracle tidak boleh
> masuk. **Bug ditemukan uji:** `getAddress()` viem tidak memvalidasi checksum (strict:false) —
> diperbaiki di `lib/admin.ts` & `scripts/set-oracle.ts` (`isAddress` strict).
> **Job demo zona abu (dihitung dari mock, tidak bergantung seed karena n=3 → subset = semua):**
> brand "Batik Sekar Lasem", 3 pertanyaan (lihat percakapan 26-09), target 3 → baseline 1/3,
> verifikasi 2/3 → `dispute`.
> Sisa Fase 8: reclaim, eskalasi, kirim ulang konten (hash tidak cocok),
> peringatan target ≤ baseline (K2), audit verdict terikat chain (S-12), mitigasi seed (S-04).

**Tujuan.** Menutup semua cabang yang tersisa — termasuk yang tidak punya gambar.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| Panel juri dikunci: `wallet === arbiter` dari `GET /api/chain-info` | `handover §3.5`. Prototipe menampilkannya ke semua orang ("mode demo"); kontrak menolak siapa pun selain arbiter — tombolnya akan **selalu** gagal untuk user biasa |
| **Arbiter harus didanai — Oracle tidak** | §A6 + §A17. Arbiter punya **0 tBNB**, jadi panel yang sudah benar pun tidak bisa mengirim satu transaksi. Oracle sudah cukup untuk ~250 job. Langkah operasional, bukan kode |
| Untuk non-arbiter, tampilkan alamat arbiter, bukan sembunyikan total | "Menunggu putusan juri" tanpa menyebut siapa jurinya terbaca seperti aplikasi yang macet |
| Tombol coba-lagi untuk `baseline_failed` + `structural_failed` | §A2. `UI_STATUS_META` menandai keduanya `retryable: true`, dan `POST /api/jobs/:id/baseline` memang membuka gerbang khusus untuk job ber-`job_state='error'` (`app/api/jobs/[id]/baseline/route.ts:45`). Fitur ini sudah ada di backend dan akan terbuang kalau FE tidak memanggilnya |
| `reclaimExpired` + `escalateStuckJob` digambar | §A12 — ada di tabel API, tidak ada di mockup |
| `last_error` ditampilkan apa adanya | Itu satu-satunya petunjuk kenapa sebuah job gagal. Menyembunyikannya di balik "terjadi kesalahan" membuang informasi yang sudah susah payah disimpan backend |

### Isi

| Kondisi | Yang muncul |
|---|---|
| `awaiting_verify` | "Verifikasi sekarang" → `POST /api/jobs/:id/verify` |
| `dispute` **dan** wallet = arbiter | Dua tombol → `arbiterDecide(jobId, bool)` |
| `dispute` **dan** wallet ≠ arbiter | Panel informasi + alamat arbiter |
| `open` **dan** `accept_deadline` lewat **dan** wallet = client | "Tarik kembali dana" → `reclaimExpired(jobId)` |
| Macet lewat `verifyTimeout` | "Eskalasi job macet" → `escalateStuckJob(jobId)` |
| `baseline_failed` | "Ukur ulang baseline" + `last_error` |
| `structural_failed` | "Coba lagi" → `POST /api/sync/:id` + `last_error` (§A2) |
| `in_progress` **dan** `last_error` terisi | Banner "kiriman sebelumnya ditolak" + form kirim ulang (§A2) |

### Cara verifikasi

**Satu langkah operasional lebih dulu** (§D.2 #2) — kirim di **testnet**, dari
MetaMask, chain ID 97:

```
dari   owner    0x8766d055bB79B511FCC34Bd1573ce612dFa4057D
ke     arbiter  0xd1ff61def4D7c6dB938A4501f460b5176fcbCd78
nilai  0,001 tBNB        ( = 83 transaksi arbiter, jauh lebih dari cukup )
```

```bash
npx tsx scripts/dev-roles.ts     # arbiter harus TIDAK lagi 0 tx
```

Oracle dan owner tidak perlu disentuh — keduanya sudah punya ratusan transaksi
(§A17).

1. Job `awaiting_verify` → "Verifikasi sekarang". Status berubah `verifying` →
   salah satu dari `settled_release` / `settled_refund` / `dispute`.
2. Bandingkan hasilnya dengan jalur murni:
   ```bash
   npm run check          # termasuk check-oracle: subset VRF & keputusan
   npx tsx scripts/dev-verify.ts
   ```
3. Job `dispute`, wallet **bukan** arbiter → tidak ada tombol putusan, ada alamat
   arbiter.
4. Ganti ke wallet arbiter (yang sudah didanai) → dua tombol muncul, dan
   **benar-benar berhasil**. Ini uji yang §A6 ada untuknya.
5. Buat job dengan `job_state='error'` (matikan sementara `ANTHROPIC_API_KEY`,
   buat job, nyalakan lagi). Tombol coba-lagi harus muncul bersama `last_error`,
   dan menekannya harus benar-benar mengukur ulang.
6. `reclaimExpired`: buat job dengan batas ambil terdekat yang diizinkan, tunggu
   lewat, muat ulang → tombol tarik dana muncul **hanya** untuk client.

---

# Fase 9 — Polling & keadaan hidup

**Tujuan.** UI bergerak sendiri saat Oracle bekerja, tanpa Realtime dan tanpa
membakar kuota.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| Polling, **bukan** Supabase Realtime | Keputusan #4 + §A1. RLS tetap mati dan anon key tetap kosong — keduanya terikat (`handover §3.7`). Menyalakan Realtime tanpa menyalakan RLS lebih dulu membuka `jobs`, `oracle_runs`, dan `activity` untuk publik, termasuk `deliverable_content` |
| Polling hanya saat ada status **hidup** di layar | Prototipe polling tiap 4 detik **tanpa syarat** (`setInterval(pollShared, 4000)`), bahkan di halaman yang tidak berubah apa-apa. Status hidup hanya tiga: `baseline_running`, `submitted_pending`, `verifying` |
| Berhenti saat tab tidak terlihat | `document.visibilityState`. Tab yang ditinggal seharian tidak perlu menembak server 21.600 kali |
| Lewat `refetchInterval` react-query, bukan `setInterval` sendiri | Sudah terpasang untuk wagmi. `useQuery` menghentikan interval saat komponen lepas — `setInterval` manual bocor kalau lupa `clearInterval`, dan prototipe memang tidak pernah membersihkannya |
| Prototipe menahan polling lewat `isTypingFocus()` | Masalah itu **hilang sendiri** di React: field terkendali tidak ditimpa oleh refetch. Tidak perlu dipindahkan |

### Isi

```ts
const HIDUP = ['baseline_running', 'submitted_pending', 'verifying'] as const;

refetchInterval: (q) =>
  document.visibilityState === 'visible' && punyaStatusHidup(q.state.data)
    ? 4000
    : false,
```

### Cara verifikasi

1. Buat job baru → DevTools → Network, filter `api/jobs`. Selama
   `baseline_running` harus ada permintaan tiap ~4 detik. Setelah jadi `open`,
   **harus berhenti**.
2. Pindah ke tab browser lain selama 30 detik, kembali. Tidak boleh ada
   permintaan yang bertambah selama tab tersembunyi.
3. Buka `/jobs/N` untuk job yang sudah settle → **nol** permintaan berulang.
4. Buka `/activity` di tab kedua sementara tab pertama mengirim transaksi. Tab
   kedua harus menampilkan baris baru tanpa dimuat ulang manual — bukti
   `POST /api/sync/:id` di Fase 5 benar-benar terpanggil.

---

# Fase 10 — Pengerasan

**Tujuan.** Melunasi utang yang sengaja ditunda, dan memastikan build produksi
jadi di mesin ini.

### Penyesuaian dari rancangan awal

| Penyesuaian | Alasan |
|---|---|
| CSP untuk halaman dipasang sekarang | `next.config.ts:83-87` menulis eksplisit bahwa ini ditunda sampai FE ada, supaya tidak memblokir skrip wallet dengan pesan yang sulit dilacak. FE-nya sudah ada |
| CSP diuji **dengan wallet terhubung**, bukan hanya halaman terbuka | Konektor wallet menyuntik skrip dan membuka koneksi RPC. CSP yang lolos di halaman statis masih bisa mematikan `eth_sendTransaction` |
| `npm run build` masuk daftar verifikasi wajib | `handover §5` — OOM terjadi saat kompilasi. Build yang tidak pernah dicoba adalah build yang tidak jalan |
| Aksesibilitas diuji, bukan diasumsikan | `node_modules/next/dist/docs/03-architecture/accessibility.md`. Badge status di Fase 1 bergantung warna; kontras + fokus keyboard harus benar-benar dicek |

### Isi

1. CSP halaman lewat `headers()` di `next.config.ts` — mengikuti
   `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`.
   **Jangan sentuh** blok `/api/:path*` yang sudah ada; itu sudah benar dan diuji.
2. `metadata` + favicon + `lang="id"`.
3. Keadaan kosong & keadaan error untuk **setiap** halaman.
4. Pemeriksaan mobile 390px pada kedelapan halaman.

### Cara verifikasi

```bash
npm run lint
npm run build
npm run check
npm run check:security
npm run openapi          # openapi.json harus TIDAK berubah — bukti 15 endpoint utuh
```

```powershell
git diff --stat openapi.json     # harus kosong
```

1. **CSP dengan wallet:** buka halaman, hubungkan MetaMask, kirim satu transaksi
   sungguhan. DevTools → Console harus **nol** pelanggaran CSP. Kalau ada,
   perbaiki direktifnya — jangan matikan CSP-nya.
2. Lighthouse (DevTools → Lighthouse) pada `/` dan `/jobs/N`: Accessibility
   **≥ 90**.
3. Navigasi **hanya dengan keyboard** dari topbar sampai tombol "Buat kontrak".
   Fokus harus selalu terlihat dan tidak pernah terjebak di dalam modal.
4. 390px pada kedelapan halaman: nol scroll horizontal.
5. Pantau memori selama `npm run build`:
   ```powershell
   Get-Process node | Select-Object Id, @{n='RAM_MB';e={[int]($_.WS/1MB)}}
   ```
   Kalau gagal alokasi, jalankan ulang dengan
   `$env:NODE_OPTIONS='--max-old-space-size=1536'; npm run build`.

---

## C. Yang TIDAK dikerjakan, dan kenapa

| Tidak dikerjakan | Alasan |
|---|---|
| **Supabase Realtime** | Keputusan #4. Kalau nanti dipakai, **RLS wajib menyala lebih dulu** — satu migrasi SQL, bukan satu baris env |
| **Dark mode** | 13 status × 2 tema = 26 kombinasi badge yang harus diuji. Token disusun supaya bisa ditambah nanti tanpa membongkar |
| **RainbowKit / WalletConnect QR** | Keputusan #1. Konsekuensi yang harus Anda tahu: **demo dari HP lewat QR tidak didukung**. Demo harus pakai wallet ekstensi di laptop |
| **i18n** | Seluruh UI Bahasa Indonesia, sama seperti prototipe dan seluruh pesan error backend |
| **Mengubah 15 endpoint** | Tidak ada satu pun fase yang membutuhkannya. Verifikasi Fase 10 membuktikannya lewat `git diff openapi.json` yang harus kosong |

---

## D. Papan keputusan

### D.1 — Keputusan atas 17 temuan

Semuanya sudah diputuskan; kolom terakhir menandai mana yang butuh tangan Anda,
bukan tangan saya.

| # | Temuan | Keputusan | Mendarat di | Butuh Anda? |
|---|---|---|---|---|
| A1 | Ringkasan §1.9 vs handover §3.7 soal Realtime | **Polling menang.** Handover lebih baru, dan Realtime mensyaratkan RLS menyala lebih dulu | Fase 9 | Ya → D.2 #3 |
| A2 | Dokumen bilang 10 status UI, kode punya 13 | **Gambar ketiga-belasnya.** Tambah 2 tombol coba-lagi + 1 keadaan menunggu yang belum punya mockup | Fase 1, 4, 8 | — |
| A3 | ~40% JS prototipe = backend yang disimulasikan | **Dihapus, bukan di-port.** Termasuk `callOracle` yang memanggil Anthropic dari browser | Fase 2–4 | — |
| A4 | Model "satu koneksi, banyak akun" | **Layar "Pilih akun" dibuang.** Deteksi peran otomatis dari alamat dipertahankan — itu bagian yang benar | Fase 5 | — |
| A5 | Kartu "Escrow Vault" tanpa sumber data | **`useBalance()` atas `contractAddress` dari `/api/chain-info`**, dan labelnya diganti | Fase 5 | Ya → D.2 #4 |
| A6 | Arbiter punya 0 tBNB | **Didanai sebelum Fase 8.** Langkah operasional, bukan kode | Fase 8 | Ya → D.2 #2 |
| A7 | `acceptDeadline` bisa melahirkan job yatim | **Lead time minimum 1 jam** + satu nilai `Date` untuk kedua panggilan | Fase 6 | Ya → D.2 #5 |
| A8 | Tidak ada sumber `jobId` saat `CHAIN_ENABLED=false` | **`jobIdDevSaja()`** — cabang dev-only, nol perubahan endpoint | Fase 6 | — |
| A9 | `jobId` pertama = 0 | **Hanya `Number.isSafeInteger(n) && n >= 0`.** Tidak ada `if (!id)` di mana pun, termasuk routing | Fase 2, 6 | — |
| A10 | Bond dihitung di FE | **Baca view `requiredBond(jobId)`.** Angka 5% & 20% tidak pernah muncul di kode FE | Fase 7 | — |
| A11 | Bentuk `oracle_runs` beda dari asumsi radar | **Selesai 2026-09-24:** `hitPerQuery()` di `lib/scoring.ts`, dipakai `runner.ts`; identik dengan aturan lama di 756 kombinasi | Fase 0 | — |
| A12 | 3 aksi ada di tabel API, tidak ada di mockup | **Digambar semua**, termasuk panel verdict | Fase 1, 4, 8 | — |
| A13 | Prototipe tidak punya konsep tx tertunda | **Satu `<TxButton>`** untuk kelima aksi tulis, `POST /api/sync/:id` di dalamnya | Fase 5 | — |
| A14 | Sisa sandbox (Reset demo, live sync, Mesin A/B) | **Dibuang / diganti** sesuai tabel §A14 | Fase 3 | — |
| A15 | Sisa scaffold `create-next-app` | **Diganti** — `globals.css` adalah tempat token Fase 1 mendarat | Fase 2 | — |
| A16 | Utang CSP halaman | **Dilunasi**, diuji dengan wallet terhubung | Fase 10 | — |
| A18 | `parseJobId` backend menerima `0x10`, `1e1`, `007`, dan angka > 2^53 | **Selesai 2026-09-24:** satu aturan di `lib/route-params.ts` untuk BE & FE; 10 route kini 400; `lib/openapi.ts` + `api.http` diperbarui | Fase 0 | — |
| A19 | `.gitignore` tidak mengabaikan `.env.local` (berisi kunci privat) | **Diperbaiki 2026-09-24:** `.env*` dikembalikan | Fase 0 | — |
| A20 | `GET /api/jobs` halaman di luar jangkauan → **500** + pesan mentah PostgREST bocor ke klien | **Diperbaiki 2026-09-24:** `listJobs()` menangkap `PGRST103` saja → `{ jobs: [], total, page, limit }` (bentuk sama), total dihitung ulang dengan filter yang sama. Uji DB `scripts/dev-list-jobs.ts` 10/10; `lib/openapi.ts` + `api.http` diperbarui; pengaman FE dicabut | Fase 3 | — |
| A21 | Pesan error mentah (PostgREST, viem, SDK Anthropic) dibungkus ke `ApiError`/`fail()` dan ke `last_error` → bocor ke klien. Pesan viem terbukti memuat **URL RPC lengkap + isi request** (koreksi Fase 5: RPC_URL saat ini publicnode TANPA kunci — kuncinya baru ikut bocor begitu RPC diganti ke penyedia berbayar; perbaikannya tetap perlu) | **Diperbaiki 2026-09-24:** `internalError()` + `publicErrorMessage()` di `lib/http.ts`; 22 lokasi diganti (asli → `cause` + log server). Bentuk respons tetap; satu efek samping: penolakan kontrak di `/verify` (revert saat simulasi ATAU receipt revert) kini `CHAIN_FAILED` (dulu `ORACLE_FAILED`), status tetap 502; pesan keduanya buatan kita (status on-chain / hash tx) dan diteruskan ke `last_error`. Anti bayar-ganda (`sudahLewat`), lock, dan retry tidak tersentuh. Guard statis di `check:security` §3 (terbukti menangkap 22/22 di kode lama). Sengaja dibiarkan: `/api/dev/seed` (dev), `/api/hello` (alat diagnosis — perketat sebelum produksi) | Fase 3 | — |
| A17 | Gas **bukan** masalah (tebakan awal meleset 100x); yang langka tBNB untuk **budget** | **Gas dibiarkan apa adanya.** Budget demo dikecilkan ke 0,002–0,005 tBNB | Fase 6 | — |

**13 dari 17 selesai di kode.** Satu yang butuh tangan Anda di blockchain:
**kirim 0,001 tBNB dari owner ke arbiter** (A6). Satu butuh persetujuan Anda
karena menyentuh kode backend: **ekstraksi `hitPerQuery()`** (A11, sebelum Fase 4).
Dua sisanya (A1, A5) cuma penyuntingan dokumen & label.

### D.2 — Lima keputusan operasional

| # | Hal | Keputusan | Kapan |
|---|---|---|---|
| 1 | Env var publik baru | **Satu**, bukan dua: `NEXT_PUBLIC_RPC_URL`. Chain ID diimpor dari `bscTestnet.id` milik viem | Fase 0 |
| 2 | Danai arbiter | **Kirim 0,001 tBNB dari owner ke arbiter, di testnet.** Itu saja. Oracle & owner sudah lebih dari cukup (§A17) | Sebelum Fase 8 |
| 3 | Baris Realtime di `Ringkasan §1.9` | **Diganti, bukan dihapus** — tulis ulang jadi "polling" + alasannya | Kapan saja |
| 4 | Label kartu kedua di Ringkasan | **"Terkunci di kontrak"** + alamat kontrak singkat | Fase 1 |
| 5 | Lead time minimum "Batas ambil" | **1 jam**, plus satu job kedaluwarsa disiapkan H-1 untuk demo `reclaimExpired` | Fase 6 |

**Kenapa #2 jadi sepele.** Versi pertama papan ini menyuruh mengejar faucet untuk
0,09 tBNB. Itu berdasarkan tebakan harga gas yang meleset seratus kali (§A17).
Dengan gas sungguhan 0,1 gwei, saldo yang sudah ada cukup untuk ratusan
transaksi — yang kurang cuma arbiter, dan owner bisa mengisinya sendiri. Isi sekali sekarang, dan Fase 6–8 tidak
pernah tersandung karenanya.

**Kenapa #5 butuh dua bagian.** 1 jam adalah batas aman terkecil untuk mencegah
job yatim (§A7). Tapi 1 jam juga terlalu lama ditunggu di panggung, padahal
`reclaimExpired` adalah salah satu cabang yang ingin ditunjukkan. Jadi batas
form tetap 1 jam, dan job kedaluwarsanya disiapkan sehari sebelumnya — pola yang
sama dengan saran "siapkan kontrak sehari sebelumnya" di form prototipe.

**Kenapa #3 diganti, bukan dihapus.** Menghapus baris membuat orang berikutnya
bertanya-tanya apakah Realtime pernah dipertimbangkan. Menuliskan keputusannya
membuat pertanyaan itu tidak perlu diajukan dua kali. Usulan penggantinya:

> **Polling, bukan Supabase Realtime.** Keputusan biaya (2026-09-23).
> `NEXT_PUBLIC_SUPABASE_ANON_KEY` sengaja kosong dan RLS sengaja mati —
> keduanya terikat. Kalau Realtime jadi dipakai, **RLS wajib dinyalakan lebih
> dulu**; tanpa itu anon key membuka `jobs`, `oracle_runs`, dan `activity`
> untuk publik, termasuk `deliverable_content`.

### D.3 — Faucet tBNB: tidak dibutuhkan untuk gas, mungkin untuk budget

**Baca §A17 dulu.** Gas sudah lebih dari cukup; bagian ini hanya relevan kalau
Anda ingin mendemokan job berbudget besar (> 0,005 tBNB), karena budget itu
terkunci di escrow, bukan terbakar.

Kalau tetap butuh, inilah keadaannya. Semua faucet BSC Testnet yang layak
sekarang **dipagari saldo mainnet** — tidak ada lagi jalur gratis untuk wallet
baru. Hasil pengujian sungguhan pada 2026-09-24, bukan daftar dari dokumentasi:

| Faucet | Pagar | Hasil |
|---|---|---|
| BNB Chain resmi | ≥ 0,002 BNB di **BSC Mainnet** | Ditolak: *"This address has less than 0.002 BNB on BSC Mainnet"* |
| QuickNode | ≥ 0,001 ETH di **Ethereum Mainnet** | Ditolak: *"Low balance for this chain and network"*, tombol Continue mati. **FAQ-nya menyatakan tanpa syarat — itu keliru** |
| Chainstack | ≥ 0,08 ETH di Ethereum Mainnet + API key | Paling berat, tidak dicoba |
| Triangle | — | Server mati (HTTP 503) |
| Bitbond | Connect wallet + profil 100% | Belum dicoba — satu-satunya yang mengklaim tanpa syarat saldo |

**Kalau suatu saat benar-benar butuh:** beli **0,002 BNB asli** (± dua dolar) ke
satu alamat di **BSC Mainnet**, lalu pakai faucet resmi — 0,3 tBNB per 24 jam.
Pagar itu berlaku **per alamat yang ditempel**, jadi cukup satu alamat yang
dibelikan BNB mainnet; sisanya diteruskan lewat transfer biasa di testnet.

**Sampai Fase 7, jangan kerjakan ini.** Budget demo 0,002–0,005 tBNB muat di
saldo yang sudah ada, dan menunjukkan alur yang sama persis.

> **Jangan tertukar jaringan.** Alamat yang sama ada di mainnet dan testnet, dan
> wallet tidak akan memperingatkan apa pun kalau salah. Transfer pertama pada
> 2026-09-24 hilang persis karena ini.

---

## E. Peta silang cepat — halaman × endpoint × fungsi kontrak

| Halaman | Endpoint | Fungsi kontrak | Fase |
|---|---|---|---|
| `/` | `GET /api/stats`, `GET /api/jobs?limit=3`, `GET /api/chain-info` | `useBalance` wallet + kontrak | 3, 5 |
| `/market` | `GET /api/jobs?filter=`, `POST /api/sync/:id` | `requiredBond` (view), `acceptJob` | 3, 7 |
| `/create` | `POST /api/jobs`, `POST /api/sync/:id` | `createJob` | 6 |
| `/my-jobs` | `GET /api/jobs?wallet=` | — | 3, 5 |
| `/jobs/[id]` | `GET /api/jobs/:id?include=runs,activity`, `GET /api/jobs/:id/verdict`, `GET /api/jobs/:id/oracle-log`, `POST /api/jobs/:id/deliverable`, `POST /api/jobs/:id/verify`, `POST /api/jobs/:id/baseline`, `POST /api/sync/:id` | `submitDeliverable`, `arbiterDecide`, `reclaimExpired`, `escalateStuckJob` | 4, 7, 8 |
| `/oracle-log` | `GET /api/oracle-log` | — | 3 |
| `/activity` | `GET /api/activity` | — | 3 |
| *(cron)* | `GET /api/indexer/poll` | — | — |
| *(dev)* | `POST /api/dev/seed` | — | 3 |

**15 endpoint, semuanya terpakai, tidak satu pun berubah bentuk.**
