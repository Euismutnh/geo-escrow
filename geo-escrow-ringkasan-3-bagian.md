# GEO Escrow — Ringkasan 3 Bagian (Frontend · Backend · Blockchain)

> Referensi cepat. Untuk detail kode/skema lengkap, lihat `geo-escrow-backend-blueprint-v2.md`. Token escrow: **tBNB native**.
>
> **Ketiga bagian sudah diselaraskan** dengan evaluasi di blueprint v2. Semua yang bertanda 🆕 belum ada di versi sebelumnya.
> Yang di **§3 wajib disampaikan ke tim blockchain sebelum kontrak dibekukan** — tiga di antaranya menambah fungsi/event baru.

---

# 1. FRONTEND (Next.js)

Tiap halaman di bawah: mockup ringkas → API yang dipanggil → fungsi blockchain yang dipanggil.

## 1.1 Ringkasan `/`

```
┌─────────────┬──────────────────────────────────────────┐
│ ◆ Ringkasan │  BNB Testnet ●live    [Connect Wallet]    │
│ ≈ Pasar     ├──────────────────────────────────────────┤
│ ✦ Buat      │  ┌─ Wallet saya ──┐  ┌─ Escrow Vault ───┐ │
│ ▤ Kontrakku │  │ 0x71c7…8976    │  │ 0xE5C4…VLT       │ │
│ ◎ Log Oracle│  │ 0.043 tBNB     │  │ 0.09 tBNB        │ │
│ ≡ Aktivitas │  └────────────────┘  └──────────────────┘ │
│             │  [Client:3] [Freelancer:2] [Juri:1] [Done:4]│
│ (wallet     │  ── Kontrak terbaru ──                     │
│  mini card) │  [card] [card] [card]                      │
└─────────────┴──────────────────────────────────────────┘
```
| API | Blockchain |
|---|---|
| `GET /api/stats?wallet=0x…` | `useBalance()` (wagmi, saldo native — bukan fungsi kontrak) |
| `GET /api/jobs?limit=3` | — |

## 1.2 Pasar `/market`

```
[Semua] [Terbuka] [Berjalan] [Perlu juri] [Selesai]

┌ Root & Bloom ──────────┐  ┌ Kopi Rasa ──────────────┐
│ Target 3/5 · Rp0.02    │  │ Target 4/6 · Rp0.03     │
│ [Lihat] [Ambil kontrak]│  │ [Lihat detail]          │
└─────────────────────────┘  └──────────────────────────┘
```
| API | Blockchain |
|---|---|
| `GET /api/jobs?filter=open` 🆕 | `acceptJob(jobId){value:bond}` — tombol "Ambil kontrak" |
| `POST /api/sync/:id` 🆕 (setelah tx dapat receipt) | `requiredBond(jobId)` view — dibaca dulu sebelum kirim tx di atas |

🆕 **`?status=` diganti `?filter=`.** Tab "Berjalan" adalah gabungan 3 status (`Accepted`, `Submitted`, `Verifying`), tidak bisa diwakili satu nilai `status`. Nilai yang sah: `all` · `open` · `progress` · `dispute` · `done`.

## 1.3 Buat Kontrak `/create`

```
[✦ Muat contoh cepat]
Nama brand        [______________]
Brief             [______________]
Query pool (3-6)  [______________]
                  [______________]
Target (dari N)   [3]   Budget (tBNB) [0.02]
Batas ambil       [2026-09-07]        ← 🆕 WAJIB
☐ Wajib lolos di 2 gaya penjawab   ← 🆕 bukan "2 mesin AI"
[ Buat kontrak & kunci dana ]
```
| API | Blockchain |
|---|---|
| `POST /api/jobs` (setelah tx sukses) | `createJob(queryPoolHash, acceptDeadline){value: budget}` |
| `POST /api/sync/:id` 🆕 (setelah receipt) | — |

🆕 **Field "Batas ambil" belum ada di prototipe, padahal `createJob` mewajibkan `acceptDeadline`.** Tanpa ini transaksi tidak bisa dibentuk. Ini juga yang dipakai `reclaimExpired()` kalau tidak ada freelancer yang mengambil.

🆕 **Hash dihitung di FE sebelum tx**, dengan fungsi yang **sama persis** dengan backend — import dari `lib/hash.ts`, jangan disalin. Beda satu karakter → `queryPoolHash` tidak cocok → `POST /api/jobs` ditolak `HASH_MISMATCH`.

## 1.4 Kontrak Saya `/my-jobs`

```
[card] [card] [card]   ← difilter: relation('client'|'freelancer') !== null
```
| API | Blockchain |
|---|---|
| `GET /api/jobs?wallet=0x…` | — (baca saja) |

## 1.5 Detail Kontrak `/jobs/[id]`

```
← Kembali                              [Kamu: Freelancer] [● Verifying]
┌─ Kiri ──────────────────────┐  ┌─ Kanan ───────────────┐
│ ● Dibuat & dana dikunci     │  │ Ledger escrow          │
│ ● Baseline diukur           │  │  Dikunci   0.02 tBNB   │
│ ● Diambil freelancer        │  │  Structural 0.004 tBNB │
│ ○ Submit hasil (aktif)      │  │  Bond      0.001 tBNB  │
│ ○ Verifikasi                │  ├────────────────────────┤
│ ○ Settlement                │  │  ⊙ Radar sitasi AI     │
│ Query pool: ● ● ○ ● ○       │  │  (baseline/verifikasi) │
│ [textarea deliverable]      │  │                        │
│ [Kirim hasil]                │  │                        │
│ (kalau status=dispute:)      │  │                        │
│ [Cairkan ke freelancer]     │  │                        │
│ [Refund ke client]          │  │                        │
└──────────────────────────────┘  └────────────────────────┘
```
| API | Blockchain |
|---|---|
| `GET /api/jobs/:id?include=runs,activity` 🆕 | `submitDeliverable(jobId, deliverableHash)` — tombol "Kirim hasil" |
| `POST /api/jobs/:id/deliverable` 🆕 **(SEBELUM tx, bukan sesudah)** | `arbiterDecide(jobId, bool)` — panel juri, **hanya kalau wallet aktif == `arbiter` dari `GET /api/chain-info`** 🆕 |
| `POST /api/jobs/:id/verify` (tombol "Verifikasi sekarang") | `reclaimExpired(jobId)` — kalau status Open & lewat deadline |
| `GET /api/jobs/:id/verdict` 🆕 — panel audit hasil | `escalateStuckJob(jobId)` — kalau macet lewat timeout |
| `POST /api/sync/:id` 🆕 (setelah tiap receipt tx) | |

🆕 **`?include=runs` menghapus satu request.** Radar sitasi butuh hit per-pertanyaan dari `oracle_runs`; tanpa parameter ini FE harus menembak dua endpoint untuk satu halaman.

🆕 **Urutan submit deliverable dibalik.** Versi lama: tanda tangan tx dulu → baru POST konten. Kalau tab ditutup di antaranya, job **nyangkut permanen** di status `Submitted` tanpa konten di DB — Oracle tidak punya apa pun untuk diverifikasi.

```
1. POST /api/jobs/:id/deliverable { content }   → backend simpan + balikkan deliverableHash
2. submitDeliverable(jobId, deliverableHash)    → tx wallet freelancer
3. POST /api/sync/:id                            → UI update instan
```

Backend melakukan structural check di langkah 1, jadi freelancer tahu kontennya lolos **sebelum** membayar gas.

🆕 **Panel juri harus dikunci ke wallet arbiter.** Prototipe menampilkannya ke semua orang ("mode demo: siapa pun boleh memutuskan"), tapi kontrak menolak siapa pun selain arbiter — tombolnya akan selalu gagal untuk user biasa.

## 1.6 Log Oracle *(tab di dalam Detail Kontrak, atau halaman sendiri)*

```
[disebut] Baseline · Root & Bloom · Claude (ringkas) · 14:02
  ▸ Pertanyaan: "Apa rekomendasi skincare organik..."
  ▸ Jawaban AI: "..."
```
| API | Blockchain |
|---|---|
| `GET /api/oracle-log?limit=150` 🆕 — halaman global (semua job) | — |
| `GET /api/jobs/:id/oracle-log` — tab di dalam detail kontrak | — |

🆕 **Dua endpoint, bukan satu.** Halaman "Log Oracle" di prototipe menampilkan log dari **semua** kontrak, bukan satu. Versi global sekalian mengembalikan `brand` lewat relasi, supaya FE tidak perlu request kedua untuk tiap baris.

🆕 **Label engine bukan "Mesin A/B".** Keputusan tim (2026-09-13): hanya satu provider AI (Claude), jadi `multi_engine` berarti dua **persona** dari model yang sama. Kolom engine ini yang dibaca juri saat menilai klaim multi-engine, jadi labelnya harus jujur -- `Claude (ringkas)` / `Claude (naratif)`, bukan `Mesin A` / `Mesin B`.

## 1.7 Aktivitas `/activity`

```
Kunci dana   0.02 tBNB   0x71c7…→0xE5c4…   0x9f3a…c21   14:00
Kunci bond   0.001 tBNB  0xF77e…→0xE5c4…   0x2b91…a04   14:05
```
| API | Blockchain |
|---|---|
| `GET /api/activity?jobId=&page=` | — (data ini hasil indexer menyalin event on-chain) |

## 1.8 Connect Wallet (modal global, semua halaman)

```
Pilih wallet:  [🦊 MetaMask] [🛡 Trust] [🔗 WalletConnect] [🔵 Coinbase]
```
| API | Blockchain |
|---|---|
| — | — (murni `wagmi`/RainbowKit `useConnect`, tidak menyentuh kontrak) |

## 1.9 🆕 Aturan yang berlaku di semua halaman

| Aturan | Kenapa |
|---|---|
| **Pakai `deriveUiStatus(job)`, jangan baca `job.status` mentah** | Prototipe punya 10 status UI, on-chain cuma 7. 10 itu **turunan** dari `status` + `job_state` + `settled_by` — bukan kolom |
| **Semua nilai wei adalah `string`. Jangan `Number()`** | Di atas ~0,009 tBNB, JS number kehilangan presisi. Pakai `BigInt` untuk hitung, `formatTBNB()` untuk tampil |
| **Supabase Realtime menggantikan `pollShared()`** | Berlangganan perubahan tabel pakai anon key. Menghilangkan polling 4 detik dan membuat baseline/verifikasi terlihat berjalan langsung |
| **Panggil `POST /api/sync/:id` setelah tiap receipt tx** | Ini yang membuat UI terasa instan. Cron indexer cuma jaring pengaman — demo tidak boleh bergantung padanya |
| **`lib/hash.ts` diimpor, bukan disalin** | FE dan BE harus menghitung hash yang sama persis, karakter demi karakter |

---

# 2. BACKEND — Daftar API (Next.js API Routes)

| Method | Endpoint | Dipanggil dari | Gerbang | Fungsi |
|---|---|---|---|---|
| `POST` | `/api/jobs` | Buat Kontrak | **hash-gated** 🆕 | Hitung ulang hash → cocokkan dengan on-chain → simpan → antrikan baseline |
| `POST` | `/api/jobs/:id/baseline` | Cron/internal, atau tombol coba-lagi | `CRON_SECRET`, atau job berstatus `error` 🆕 | Jalankan/**lanjutkan** pengukuran AI baseline (T0) |
| `POST` | `/api/jobs/:id/deliverable` | Detail Kontrak, **sebelum tx** 🆕 | **hash-gated** 🆕 | Structural check → simpan konten → balikkan `deliverableHash` untuk dipakai di tx |
| `POST` | `/api/jobs/:id/verify` | Detail Kontrak (tombol Verifikasi) | rate-limit + status guard + lock atomik 🆕 | Seed on-chain → subset VRF → AI (T1) → `settleRelease`/`settleRefund`/`raiseDispute` |
| `POST` | `/api/sync/:id` 🆕 | FE, setelah tiap receipt tx | rate-limit | Sinkronkan 1 job dari chain → UI update instan |
| `POST` | `/api/dev/seed` 🆕 | Manual saat development | ditolak di production | Isi data contoh |
| `GET` | `/api/jobs` | Pasar, Ringkasan, Kontrak Saya | publik | List + `?filter=` 🆕 + `?wallet=` + `?page=` + `?limit=` |
| `GET` | `/api/jobs/:id` | Detail Kontrak | publik | Detail 1 job + `?include=runs,activity` 🆕 |
| `GET` | `/api/jobs/:id/verdict` 🆕 | Panel audit | publik | Verdict lengkap + perbandingan hash DB vs on-chain |
| `GET` | `/api/oracle-log` 🆕 | Log Oracle (halaman global) | publik | Run AI dari **semua** job |
| `GET` | `/api/jobs/:id/oracle-log` | Tab log di detail | publik | Run AI 1 job |
| `GET` | `/api/activity` | Aktivitas | publik | Ledger transaksi (opsional `?jobId=`) |
| `GET` | `/api/stats` | Ringkasan | publik (opsional `?wallet=`) | Hitungan ringkasan per wallet |
| `GET` | `/api/indexer/poll` | Cron eksternal | `CRON_SECRET` header | Jaring pengaman: kejar event yang terlewat |

**Prinsip pembagian:** endpoint `POST` di atas = satu-satunya tempat yang menyentuh **private key Oracle** dan **API key AI**. Semua endpoint `GET` murni baca dari database (bukan dari chain), supaya cepat dan bisa difilter.

## 2.1 🆕 Siapa boleh menulis kolom apa

Ini aturan yang paling gampang dilanggar tanpa sadar, dan akibatnya paling sulit dilacak.

| Penulis | Boleh menulis | **Dilarang menulis** |
|---|---|---|
| Route `POST` (user) | `brand`, `brief`, `queries`, `deliverable_content` | `status`, semua kolom uang |
| Worker Oracle | `baseline_*`, `verification_*`, `oracle_runs`, `job_state` | `status`, semua kolom uang |
| **Indexer** | `status`, semua kolom uang, `settled_by`, `activity` | — |

Kalau route API ikut menulis `status`, indexer yang memproses blok lama bisa **memundurkan** status job. Sumber kebenaran untuk status & uang hanya satu: event on-chain.

## 2.2 🆕 Gerbang hash-gated

Tidak ada login dan tidak ada popup tanda tangan. Backend menerima data **hanya kalau hash-nya cocok dengan yang sudah terkunci di blockchain**:

```
FE  : h = queryPoolHash({brand, queries, targetCount, multiEngine})
FE  : createJob(h, deadline) {value: budget}        ← tx wallet client
FE  : POST /api/jobs { jobId, brand, queries, ... }
BE  : hitung ulang h' dari body
BE  : bandingkan dengan getJob(jobId).queryPoolHash
      cocok → simpan   ·   tidak → 400 HASH_MISMATCH
```

Data palsu ditolak oleh matematika, bukan oleh daftar izin. Penyerang tidak bisa mengubah yang di blockchain tanpa membayar budget dari wallet-nya sendiri.

**Batasnya:** `brief` tidak ikut ter-hash (murni kosmetik, tidak memengaruhi penilaian Oracle).

## 2.3 🆕 Dua flag yang membuat backend jalan tanpa kontrak

```bash
CHAIN_ENABLED=false     # verifikasi on-chain di-skip, writeContract jadi no-op
ORACLE_PROVIDER=mock    # tanpa API key AI, gratis, hasil deterministik
```

Dengan ini **seluruh backend + frontend bisa dibangun dan didemokan sebelum kontrak selesai**. Saat kontrak siap, ubah kedua nilai — tidak ada kode yang perlu diubah.

---

# 3. BLOCKCHAIN — Daftar Fungsi Kontrak (`GeoEscrow.sol`)

| Fungsi | Pemanggil | payable? | Fungsi |
|---|---|---|---|
| `createJob(queryPoolHash, acceptDeadline)` | Client (wallet sendiri) | ✅ (`value` = budget) | Buka job baru, kunci tBNB, status → `Open`. **Kontrak cuma MENYIMPAN `bytes32 queryPoolHash` apa adanya — jangan hitung hash-nya di Solidity.** Backend yang memverifikasi dengan menghitung ulang dari data DB |
| `acceptJob(jobId)` | Freelancer (wallet sendiri) | ✅ (`value` = bond, harus persis sama dengan `requiredBond`) | Ambil job, kunci bond, status → `Accepted` |
| `submitDeliverable(jobId, deliverableHash)` | Freelancer (wallet sendiri) | ❌ | Catat bukti hash deliverable, status → `Submitted` |
| `confirmStructural(jobId)` | **Oracle** (backend) | ❌ | Cairkan 20% budget, status → `Verifying`, **DAN simpan `block.prevrandao` sebagai seed VRF job ini** |
| 🆕 `rejectStructural(jobId, reason)` | **Oracle** (backend) | ❌ | Structural check gagal → status balik ke `Accepted` supaya freelancer bisa submit ulang. **Tanpa fungsi ini, job mati permanen di `Submitted`** |
| `settleRelease(jobId, verdictHash)` | **Oracle** (backend) | ❌ | Cairkan sisa + bond ke freelancer, status → `ReleasedFull` |
| `settleRefund(jobId, verdictHash)` | **Oracle** (backend) | ❌ | Refund sisa + bond (slash) ke client, status → `Refunded` |
| `raiseDispute(jobId, verdictHash)` | **Oracle** (backend) | ❌ | Skor di zona abu, status → `Disputed` |
| `arbiterDecide(jobId, toFreelancer)` | **Arbiter** (wallet sendiri) | ❌ | Putuskan dispute manual, panggil settle internal |
| `reclaimExpired(jobId)` | Client (wallet sendiri) | ❌ | Tarik dana kalau tidak ada yang ambil sampai deadline |
| `escalateStuckJob(jobId)` | Siapa saja | ❌ | Paksa job macet (Oracle mati >7 hari) ke status `Disputed` |
| `requiredBond(jobId)` *(view)* | Frontend (baca saja) | ❌ | Hitung berapa tBNB yang harus dikirim di `acceptJob` |
| 🆕 `verificationSeed(jobId)` *(view)* | **Oracle** (backend) | ❌ | `bytes32` seed yang disimpan saat `confirmStructural`. Subset VRF diturunkan deterministik darinya → **siapa pun bisa mengaudit ulang pilihan subsetnya** |
| `getJob(jobId)` *(view)* | Frontend + backend (verifikasi 1 job) | ❌ | Ambil seluruh state 1 job — **bukan untuk listing massal**. Bentuk kembaliannya dikunci di §3.2 |
| `setOracle(addr)` / `setArbiter(addr)` | Owner (deploy wallet) | ❌ | Admin — ganti wallet Oracle/Arbiter |

## 3.1 Event — nama argumen WAJIB dikunci

Indexer memetakan `log.args.<nama>` satu per satu. Kalau nama argumen beda satu huruf, indexer **gagal diam-diam** — tidak ada error, datanya cuma tidak pernah masuk. Kunci daftar ini sebelum deploy.

| Event | Argumen | Dipakai indexer untuk |
|---|---|---|
| `JobCreated` | `uint256 indexed jobId, address indexed client, uint256 budget, bytes32 queryPoolHash, uint256 acceptDeadline` | status → `Open`, isi `budget_wei`, baris `deposit` |
| `JobAccepted` | `uint256 indexed jobId, address indexed freelancer, uint256 bond` | status → `Accepted`, isi `freelancer_addr` + `bond_wei`, baris `bond_lock` |
| `DeliverableSubmitted` | `uint256 indexed jobId, bytes32 deliverableHash` | status → `Submitted`, cocokkan hash dengan konten di DB |
| `StructuralConfirmed` | `uint256 indexed jobId, uint256 amount, bytes32 seed` | status → `Verifying`, isi `structural_released_wei`, baris `structural_release` |
| 🆕 `StructuralRejected` | `uint256 indexed jobId, string reason` | status balik → `Accepted`, tampilkan alasan ke freelancer |
| `Settled` | `uint256 indexed jobId, bool toFreelancer, `**`bool byArbiter`**`, address recipient, uint256 amount, bytes32 verdictHash` | status → `ReleasedFull`/`Refunded`, isi `settled_by` |
| 🆕 `BondSettled` | `uint256 indexed jobId, address recipient, uint256 amount, bool slashed` | baris `bond_return` / `bond_slash` |
| `DisputeRaised` | `uint256 indexed jobId, bytes32 verdictHash` | status → `Disputed` |
| `ArbiterDecided` | `uint256 indexed jobId, bool toFreelancer` | jejak audit (settlement-nya sendiri lewat `Settled`) |
| `Reclaimed` | `uint256 indexed jobId, address indexed client, uint256 amount` | status → `Refunded`, baris `reclaim` |

**Dua perubahan pada event yang sudah ada:**

- **`Settled` perlu `bool byArbiter`.** `ArbiterDecided` memang sudah ada di daftar lama, tapi mengandalkan "dua event dalam satu transaksi" membuat indexer harus mengorelasikan `tx_hash` — rapuh. Satu flag di `Settled` menyelesaikannya. Prototipe membedakan `settled_release` (Oracle) dari `jury_release` (juri); tanpa flag ini backend tidak bisa membedakannya.
- **`StructuralConfirmed` perlu `bytes32 seed`.** Supaya backend tidak perlu memanggil view terpisah setelah tiap konfirmasi.

**`BondSettled` benar-benar baru.** `settleRelease` memindahkan **dua** jumlah: sisa budget *dan* bond. Prototipe mencatatnya sebagai dua baris terpisah di halaman Aktivitas (`bond_return` / `bond_slash`), tapi daftar event lama tidak punya apa pun untuk bond. Tanpa event ini, pergerakan bond tidak akan pernah muncul di ledger.

## 3.2 Bentuk kembalian `getJob(jobId)`

Backend bergantung penuh pada ini untuk gerbang hash-nya. Kunci field-nya:

```solidity
struct JobView {
    address client;
    address freelancer;      // address(0) kalau belum ada
    bytes32 queryPoolHash;   // dibandingkan dengan hash hitungan backend
    bytes32 deliverableHash; // bytes32(0) kalau belum submit
    bytes32 verdictHash;     // bytes32(0) kalau belum settle — dipakai /api/jobs/:id/verdict
    bytes32 verificationSeed;
    uint256 budget;
    uint256 bond;
    uint256 structuralReleased;
    uint8   status;          // urutan enum harus sama dengan tabel status backend
    uint256 acceptDeadline;
}
```

`verdictHash` **wajib bisa dibaca ulang** — itulah yang membuat hasil Oracle bisa diaudit publik. Kalau kontrak cuma menerimanya tanpa menyimpan, klaim "trustless" kalian tidak bisa dibuktikan.

## 3.3 Konstanta & satuan yang harus disepakati

| Hal | Nilai di prototipe | Catatan |
|---|---|---|
| Bond freelancer | **5%** dari budget | `requiredBond()` harus mengembalikan angka ini persis; `acceptJob` menolak `value` yang tidak sama |
| Pencairan struktural | **20%** dari budget | Backend **tidak** menghitung ini sendiri — angkanya dibaca dari event |
| Satuan `acceptDeadline` | — | **unix detik atau nomor blok?** Kolom DB bertipe `timestamptz` |
| Timeout `escalateStuckJob` | 7 hari | Terlalu lama untuk didemokan. Buat bisa dikonfigurasi, atau pendekkan di testnet |
| Urutan enum status | `Open, Accepted, Submitted, Verifying, Disputed, ReleasedFull, Refunded` | `getJob().status` mengembalikan `uint8` — urutannya harus persis ini |

**Yang TIDAK boleh dipanggil backend/Oracle atas nama user:** `createJob`, `acceptJob`, `submitDeliverable`, `arbiterDecide`, `reclaimExpired` — semua ini wajib transaksi asli dari wallet user sendiri (client/freelancer/arbiter), bukan backend yang bertindak atas nama mereka.

---

## Peta silang cepat (siapa pegang apa)

| Peran | Wallet sendiri (frontend langsung) | Butuh Backend? |
|---|---|---|
| **Client** | `createJob`, `reclaimExpired` | Tidak |
| **Freelancer** | `acceptJob`, `submitDeliverable` | Tidak |
| **Oracle** | — | **Ya** — `confirmStructural`, `rejectStructural`, `settleRelease/Refund`, `raiseDispute` (private key + API key AI wajib di server) |
| **Arbiter** | `arbiterDecide` | Tidak |
| **Siapa saja** | `escalateStuckJob`, semua `GET /api/...` | Tidak |
