# Serah Terima ke Sesi Frontend

> Tempel berkas ini di awal percakapan baru. Isinya hal-hal yang **tidak bisa
> ditebak dari membaca kode** — sisanya ada di repo dan bisa dibaca sendiri.

---

## 1. Keadaan sekarang

**Backend selesai seluruhnya (Fase 0–11).** 15 endpoint hidup, teruji, terdokumentasi.
Frontend **belum ada sama sekali** — `app/page.tsx` masih halaman bawaan Next.js.

```
app/
  page.tsx        <- halaman bawaan, belum disentuh
  layout.tsx
  docs/route.ts   <- Swagger UI (HTML mentah, bukan React)
  api/            <- 15 route, JANGAN diubah tanpa alasan kuat
lib/              <- hash, vrf, scoring, verdict, status, format, abi, indexer
scripts/          <- uji & alat bantu
```

Dependensi wallet **belum terpasang**:

```bash
npm install wagmi @rainbow-me/rainbowkit @tanstack/react-query
```

---

## 2. Yang WAJIB dibaca sebelum menulis kode

| Berkas | Isinya |
|---|---|
| `AGENTS.md` | **Next.js 16 punya breaking change.** Wajib baca `node_modules/next/dist/docs/` sebelum menulis kode — bukan mengandalkan ingatan |
| `geo-escrow-ringkasan-3-bagian.md` **Bagian 1** | Mockup tiap halaman + API & fungsi blockchain yang dipanggil. **Ini spesifikasi FE-nya** |
| `geo-escrow-backend-blueprint-v2.md` Bagian 5 | Tabel kontrak API lengkap |
| `http://localhost:3000/docs` | Swagger — coba tiap endpoint sebelum menulis pemanggilnya |
| `api.http` | 65+ request dengan hasil yang diharapkan |

**Prototipe HTML tidak ada di repo.** Kalau desainnya mau dipertahankan, lampirkan
ulang berkasnya di percakapan baru.

---

## 3. Tujuh hal yang paling sering salah

Semuanya sudah pernah jadi bug nyata, atau sengaja dirancang berbeda dari dugaan.

### 1. `lib/hash.ts` di-IMPORT, jangan disalin

FE menghitung `queryPoolHash` sebelum mengirim `createJob()`. Backend menghitung
ulang dari body dan membandingkannya. **Beda satu karakter → `POST /api/jobs`
ditolak `HASH_MISMATCH`**, dan job-nya sudah terlanjur ada on-chain.

### 2. Deliverable: POST konten DULU, baru tanda tangan

```
1. POST /api/jobs/:id/deliverable { content }  -> dapat deliverableHash
2. submitDeliverable(jobId, deliverableHash)   -> tx wallet freelancer
3. POST /api/sync/:id                          -> UI update instan
```

Urutan terbalik (tanda tangan dulu) membuat job **nyangkut permanen** di status
`Submitted` tanpa konten di database kalau tab ditutup di antaranya — Oracle tidak
punya apa pun untuk diverifikasi. Bonus: structural check jalan di langkah 1, jadi
freelancer tahu kontennya lolos **sebelum** membayar gas.

### 3. `jobId` pertama adalah **0**, bukan 1

Sudah dibuktikan lewat `simulateContract`. Jadi `if (!jobId)` membuang job 0 yang sah.

### 4. Semua nilai wei adalah **string**

`budget_wei`, `bond_wei`, `structural_released_wei`. Jangan pernah `Number()` —
di atas 2^53 presisinya hilang (~0,009 tBNB). Pakai `BigInt()`. Sudah ada
`formatTBNB()` dan `toWei()` di `lib/format.ts`.

### 5. Panel juri dikunci ke `arbiter` dari `GET /api/chain-info`

Prototipe menampilkannya ke semua orang ("mode demo"). Kontrak menolak siapa pun
selain arbiter — tombolnya akan **selalu gagal** untuk user biasa.
Kolom `jobs.arbiter_addr` sudah dihapus; arbiter adalah nilai tingkat-kontrak.

### 6. `?filter=`, bukan `?status=`

Nilai sah: `all` · `open` · `progress` · `dispute` · `done`.
`progress` adalah gabungan 3 status (`Accepted`, `Submitted`, `Verifying`) —
tidak bisa diwakili satu nilai status. Lihat `MARKET_FILTERS` di `lib/status.ts`.

### 7. Polling, bukan Supabase Realtime

Keputusan biaya, bukan teknis. `NEXT_PUBLIC_SUPABASE_ANON_KEY` sengaja kosong dan
RLS sengaja mati — keduanya terikat. **Kalau Realtime jadi dipakai, RLS WAJIB
dinyalakan lebih dulu**, kalau tidak anon key membuka seluruh tabel untuk publik.

---

## 4. Yang juga perlu diingat

- **Field "Batas ambil" (`acceptDeadline`) wajib ada di form `/create`.** Tidak ada
  di prototipe, padahal `createJob()` mewajibkannya. Tanpa itu transaksinya tidak
  bisa dibentuk.
- **`POST /api/sync/:id` dipanggil setelah TIAP receipt tx.** Ini yang membuat UI
  terasa instan; cron cuma jaring pengaman.
- **`GET /api/jobs/:id?include=runs,activity`** menghemat dua request untuk halaman
  detail.
- **Label engine harus jujur.** Keputusan tim: hanya satu provider AI (Claude), jadi
  `multi_engine` berarti dua **persona** dari model yang sama. Tulis
  `Claude (ringkas)` / `Claude (naratif)`, **bukan** `Mesin A` / `Mesin B`.
  Klaim "lolos di ≥2 mesin AI" sudah tidak mungkin jujur dengan konfigurasi ini.

---

## 5. Kendala lingkungan yang nyata

- **Mesin ini 3,88 GB RAM, sering < 1 GB bebas.** Dev server pernah OOM saat
  Turbopack mengompilasi (`memory allocation of 16777216 bytes failed`).
  Hindari dependensi berat. Itu juga alasan `/docs` memuat Swagger dari CDN,
  bukan `npm i swagger-ui-react`.
- **Git Bash + heredoc sering merusak escape** pada regex (`\\b` jadi `\b`).
  Pakai tool tulis berkas langsung untuk berkas yang memuat regex.

---

## 6. Fakta rantai (terverifikasi 23 Sep 2026)

| | |
|---|---|
| Kontrak | `0x41462F3092Ca66b7B3d9c8b20337793e2756cC46` |
| Jaringan | BSC Testnet, chain ID **97** |
| RPC | `https://bsc-testnet-rpc.publicnode.com` |
| Owner | `0x8766d055bB79B511FCC34Bd1573ce612dFa4057D` |
| Oracle | `0xA87D9c3304B13a0325Ae91A05d2322f4C8f3a139` (0,006 tBNB) |
| Arbiter | `0xd1ff61def4D7c6dB938A4501f460b5176fcbCd78` (**0 tBNB**) |
| `jobCount()` | **0** — belum ada job sama sekali |
| Waktu blok | 0,45 detik |

`CHAIN_ENABLED` masih `false`. Dengan begitu gerbang hash mati dan `POST /api/jobs`
menerima job apa pun — **itu disengaja** supaya FE bisa dibangun tanpa membayar gas
tiap kali menguji. Nyalakan saat siap menguji alur on-chain sungguhan.

> Kontrak **belum diverifikasi** di BscScan, jadi tidak ada tab "Write Contract".
> Untuk memanggil fungsi owner, pakai `scripts/set-oracle.ts` sebagai pola.

---

## 7. Cara menguji

```bash
npm run dev                 # lalu buka /docs
npm run check               # 176 uji murni
npm run check:security      # audit pra-deploy, 22 pemeriksaan
npx tsx scripts/dev-chain-read.ts   # jalur baca chain (20)
npx tsx scripts/dev-indexer.ts      # indexer (37)
npm run openapi             # tulis openapi.json buat Postman
```

Kalau mengubah bentuk respons endpoint, **`lib/openapi.ts` harus ikut diperbarui** —
itu satu-satunya dokumentasi yang tidak dijaga mesin.

---

## 8. Cara memulai percakapan barunya

Saran urutan permintaan:

1. Minta ia **membaca** `AGENTS.md`, `geo-escrow-ringkasan-3-bagian.md` Bagian 1,
   dan berkas ini dulu — sebelum menulis kode apa pun.
2. Lampirkan prototipe HTML kalau desainnya mau dipertahankan.
3. Minta **blueprint frontend** dengan bentuk yang sama seperti blueprint backend:
   fase bertahap, tiap fase menyebut penyesuaian dari rancangan awal beserta
   alasannya, dan tiap fase punya cara verifikasi yang bisa dijalankan.
4. Baru mulai kode, dari `/create` — halaman itu yang menghasilkan job on-chain
   pertama dan membuktikan seluruh rantai hidup.

**Yang tidak boleh diubah tanpa alasan kuat:** bentuk 15 endpoint yang sudah ada.
Semuanya sudah teruji dan terdokumentasi; mengubahnya berarti memperbarui
`lib/openapi.ts`, `api.http`, dan blueprint sekaligus.
