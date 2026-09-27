# GEO Escrow — Daftar periksa deploy

> Untuk tim · 27-09-2026 · Hosting: Vercel · DB: Supabase · Chain: BNB Smart Chain Testnet (97)

## 1. Sebelum deploy (di mesin lokal)

```bash
npm run lint
npm run check            # uji murni, oracle, input
npm run check:security   # rahasia tidak bocor ke bundle, header, interlock
npm run build            # WAJIB — mesin 3,88 GB pernah OOM saat build
npm run openapi          # openapi.json harus TIDAK berubah (bukti 15 endpoint utuh)
git status --short openapi.json
npx tsx scripts/dev-health.ts   # baca saja: job macet, DB≠chain, saldo gas, indexer, kuota AI
```

Kalau build kehabisan memori: `$env:NODE_OPTIONS='--max-old-space-size=1536'; npm run build`.

## 2. Database (sekali, untuk project Supabase baru)

Jalankan berurutan di SQL Editor:
1. `supabase/schema-00-base.sql`
2. `supabase/migration-01-activity-types-and-arbiter.sql`

RLS sengaja mati (tidak ada anon key di browser). **Nyalakan RLS + policy sebelum anon key dipakai di mana pun.**

## 3. Environment variables di Vercel

Salin daftar dari `.env.example`. Yang sering salah:

| Variabel | Produksi | Catatan |
|---|---|---|
| `CHAIN_ENABLED` | `true` | Tanpa ini settlement tidak terjadi; beberapa route menolak jalan |
| `ORACLE_PROVIDER` | `claude` | Kalau tetap `mock`, wajib `ALLOW_MOCK_ORACLE_IN_PRODUCTION=true` **dan** disebut ke juri |
| `ANTHROPIC_API_KEY` | isi | Hanya server; tidak pernah masuk bundle (dicek `check:security`) |
| `ORACLE_DAILY_CALL_LIMIT` / `ORACLE_CLIENT_DAILY_CALL_LIMIT` | 400 / 60 | Kosong = default; batas biaya AI |
| `CRON_SECRET` | acak ≥ 32 karakter | Kosong = poll TERTUTUP |
| `RPC_URL` | boleh berkunci | Server saja |
| `NEXT_PUBLIC_RPC_URL` | **tanpa kunci** | Terlihat publik; origin-nya otomatis masuk CSP `connect-src` saat build |
| `ORACLE_PRIVATE_KEY` | isi | Wallet = `oracle()` kontrak, punya tBNB |

Setelah mengubah `NEXT_PUBLIC_RPC_URL`, **deploy ulang** (nilainya dibaca saat build, termasuk untuk CSP).

## 4. Cron (jaring pengaman)

`vercel.json` menjadwalkan `GET /api/indexer/poll` **sekali sehari, 03:00 UTC** — disesuaikan untuk
**plan Hobby** (keputusan tim, 27-09-2026), yang membatasi cron hanya boleh berjalan sekali per hari.

Sistem **tidak bergantung** pada cron ini untuk kebenaran — status job disinkronkan langsung setelah
setiap transaksi (`POST /api/sync/:id`, dipanggil otomatis oleh `<TxButton>`). Yang ditangkap cron
hanya jaring pengaman: transaksi dari luar aplikasi (Etherscan, wallet lain), lock yang macet karena
proses terpotong, dan job yang tertinggal di `Submitted`. Sekali sehari cukup untuk itu.

Kalau nanti pindah ke **plan Pro**, jadwal boleh dipercepat (mis. `*/5 * * * *`) untuk ledger Aktivitas
yang lebih segar — bukan keharusan.

**Sebelum demo:** jalankan poll manual sekali lewat curl (langkah §5.3) supaya ledger tidak menunggu
sampai jadwal berikutnya.

## 5. Setelah deploy

1. Header terkirim:
   ```bash
   curl -sI https://<app>/ | grep -i "content-security-policy\|strict-transport\|nosniff"
   curl -sI https://<app>/api/stats | grep -i "cache-control\|content-security-policy"
   ```
2. Buka aplikasi, **hubungkan wallet sungguhan**, lakukan satu transaksi kecil. DevTools → Console: **nol** pelanggaran CSP. (Sudah diuji otomatis dengan wallet tiruan di 10 halaman: nol.)
3. Poll pertama (mengejar ketertinggalan): `curl -H "Authorization: Bearer <CRON_SECRET>" https://<app>/api/indexer/poll` — `blokDilompati` boleh > 0 sekali, harus 0 di putaran berikutnya.
4. `npx tsx scripts/dev-health.ts` → "SEHAT".

## 6. Pertama kali memakai Claude (biaya sungguhan)

1. Buat satu kontrak kecil (budget minimum 0,0005 tBNB, 3 pertanyaan) — baseline memanggil AI 3× (6× bila dua gaya penjawab).
2. Periksa Log Oracle: jawaban wajar, kolom model terisi (`claude-opus-5`, atau model cadangan bila terjadi refusal fallback).
3. Pantau pemakaian di Console Anthropic; kuota harian di aplikasi membatasi pengurasan.

## 7. Jangan pernah

- `POST /api/dev/seed` — menghapus job 1–6 (kini ditolak saat `CHAIN_ENABLED=true`).
- `renounceOwnership` / `transferOwnership` di kontrak.
- `setVerifyTimeout` — berlaku surut ke semua kontrak.
- Menempelkan private key di chat, issue, atau commit.
