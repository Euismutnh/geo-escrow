# GEO Escrow — Batasan & Roadmap v2

> Untuk juri & tim · 27-09-2026 · Kontrak `0x41462F3092Ca66b7B3d9c8b20337793e2756cC46` (BNB Smart Chain Testnet, chain 97)

GEO Escrow menahan budget client di smart contract dan mencairkannya ke freelancer **hanya kalau AI
benar-benar lebih sering menyebut brand client** — diukur Oracle, dan hasilnya bisa diaudit siapa pun.
Dokumen ini menjelaskan apa yang sudah terbukti, apa yang masih harus dipercaya, dan apa rencana
berikutnya. Kami menuliskannya sendiri karena sistem escrow yang jujur harus jujur juga soal batasnya.

---

## 1. Yang sudah terbukti di blockchain (bukan simulasi)

| Jalur | Kontrak | Hasil | Bukti |
|---|---|---|---|
| Target tercapai → dana cair | #0 Kopi Lereng Merapi | Skor 4/4 → sisa budget + bond ke freelancer | settle `0x46c3803e…` |
| Zona abu → putusan arbiter | #1 Batik Sekar Lasem | Skor 2/3 → arbiter memutus refund, bond freelancer disita | putusan `0x4cf4d39b…` |
| Undian pertanyaan tidak bisa ditebak (GEOv2) | #3 Tenun Ikat Sumba Lestari | 4 dari 5 pertanyaan diundi dari blok konfirmasi → cair | konfirmasi `0x65526553…`, settle `0xa0e39a26…` |
| Tidak ada freelancer → dana ditarik client | #2 Rotan Cirebon Asri | Batas ambil lewat → seluruh budget kembali ke client | tarik kembali `0xec5df20e…` |

Pada setiap kontrak: saldo ledger aplikasi **= 0** setelah selesai, dan saldo kontrak on-chain kini **0** — seluruh dana keempat kontrak keluar ke pihak yang benar. Untuk ketiga kontrak yang diverifikasi (#0, #1, #3), audit
verdict di browser lolos 8/8 (seed, subset, jawaban AI, keputusan, hash verdict di database dan di
kontrak, parameter kontrak, hash pertanyaan & konten).

## 2. Apa yang bisa diaudit siapa pun, dan apa yang masih dipercaya

**Bisa dicek sendiri, tanpa mempercayai kami:**
- Dana: dikunci, dicairkan, dan dikembalikan oleh smart contract — tidak ada fungsi admin untuk menarik dana.
- Pertanyaan & target: di-hash ke kontrak saat kontrak dibuat; tidak bisa diganti setelahnya.
- Konten freelancer: di-hash dan ditandatangani freelancer sendiri; Oracle hanya boleh mengukur konten itu.
- Pertanyaan mana yang diperiksa: diundi dari data publik (seed kontrak + hash blok konfirmasi + nomor kontrak + hash konten) dan dihitung ulang di browser pengunjung.
- Keputusan: aritmetika integer dari skor yang dipublikasi; hash verdict tercatat di kontrak.

**Masih harus dipercaya:**
- **Oracle** benar-benar bertanya ke AI dan mencatat jawabannya apa adanya. Log jawaban dipublikasi, tapi jawaban AI tidak bisa dibuktikan secara kriptografis.
- **Arbiter** memutus sengketa dengan adil — satu wallet untuk seluruh platform, ditunjuk pemilik kontrak.
- **Pemilik kontrak (owner)** — tidak bisa menarik dana, tapi bisa mengganti alamat Oracle dan arbiter. Setiap penggantian tercatat publik sebagai event on-chain (`OracleChanged`, `ArbiterChanged`).

## 3. Batasan saat ini

| # | Batasan | Dampak | Status |
|---|---|---|---|
| B1 | Kontrak yang sudah diambil freelancer **tidak punya tenggat pengerjaan** | Kalau freelancer menghilang, dana client tertahan tanpa jalan keluar | Butuh kontrak v2 |
| B2 | **Bond 5% lebih kecil dari pencairan struktural 20%** | Freelancer bisa untung 15% dengan konten minimal, walau akhirnya refund | Butuh kontrak v2; cek struktural bisa diperketat |
| B3 | **Seed acak kontrak di BSC praktis konstan** (`block.prevrandao` = 2) | Tanpa mitigasi, pertanyaan yang diperiksa bisa ditebak | **Dimitigasi** (GEOv2, di Oracle); undian on-chain penuh butuh VRF di v2 |
| B4 | **Satu arbiter** untuk semua kontrak, dipilih pemilik platform | Pengguna tidak bisa memilih wasit | Roadmap v2 |
| B5 | Demo memakai **penjawab AI simulasi (mock)** | Hasil demo deterministik, tidak membaca isi konten | Claude diaktifkan setelah pengamanan prompt & batas biaya |
| B6 | Keputusan membandingkan skor dengan **target, bukan dengan baseline** | Target ≤ baseline = dana bisa cair tanpa peningkatan | **Diperingatkan** di aplikasi |
| B7 | Batas waktu eskalasi **7 hari**, satu nilai untuk semua kontrak | Pengubahan berlaku surut ke semua kontrak | Sengaja tidak disediakan di aplikasi |
| B8 | "Dua gaya penjawab" = **satu model AI** dengan dua persona | Bukan verifikasi lintas mesin AI | Disebut apa adanya di aplikasi |
| B9 | RPC publik testnet: log hanya ±11 jam, kadang lambat | Riwayat ledger lama bisa tidak lengkap | Status & dana tidak terpengaruh (dibaca langsung dari kontrak) |

## 4. Yang sudah kami perbaiki tanpa mengubah kontrak

- Oracle **tidak bisa melangkahi arbiter**: settle hanya dikirim bila status on-chain masih Verifying.
- Undian pertanyaan **GEOv2**: tidak bisa ditebak freelancer; blok konfirmasi divalidasi (tujuan, fungsi, nomor kontrak, tidak revert) di server **dan** di browser.
- Audit verdict **terikat ke kontrak**: verdict dengan seed/target/pertanyaan/konten lain langsung tampil merah.
- **Pemulihan otomatis**: status database mengikuti chain setelah setiap transaksi Oracle; proses yang terputus bisa dilanjutkan tanpa pembayaran ganda.
- Jalan keluar yang tersedia di kontrak dibuat bisa dipakai dari aplikasi: tarik kembali dana, eskalasi ke arbiter setelah batas waktu, putusan arbiter, kirim ulang konten yang ditandatangani.

## 5. Roadmap v2 (urut prioritas)

1. **Tenggat pengerjaan** — kontrak yang tidak dikirim hasil sampai tenggat bisa ditarik client; bond ke client. *(menutup B1)*
2. **Ekonomi bond** — bond ≥ bagian yang cair di cek struktural, atau 20% baru cair saat target tercapai. *(B2)*
3. **Keacakan on-chain** — Chainlink VRF, supaya undian tidak bergantung pada Oracle sama sekali. *(B3)*
4. **Arbiter terdesentralisasi** — dipilih bersama client & freelancer per kontrak, atau panel/multisig. *(B4)*
5. **Oracle yang lebih kuat** — beberapa model AI berbeda, pengamanan instruksi tersembunyi di konten, kuota biaya. *(B5, B8)*
6. **Keputusan berbasis peningkatan** — dana cair kalau skor naik dari baseline, bukan sekadar mencapai angka. *(B6)*
7. **Pengerasan kontrak** — pembayaran pull (bukan push), `Ownable2Step`, budget minimum, batas waktu per kontrak. *(B7)*

## 6. Pertanyaan yang mungkin diajukan

**Bagaimana kalau Oracle curang?** Oracle tidak bisa memindahkan dana di luar aturan kontrak, tidak bisa
mengganti pertanyaan atau konten, tidak bisa memilih pertanyaan yang diperiksa, dan tidak bisa memutus
sengketa. Yang tersisa — kejujuran mencatat jawaban AI — dibuka lewat log publik, dan menjadi prioritas #5.

**Kenapa kontraknya tidak diperbaiki sekarang?** Kontrak di blockchain tidak bisa diubah setelah deploy;
menggantinya menjelang demo berarti alamat baru dan semua uji diulang. Yang bisa diperbaiki di luar kontrak
sudah kami perbaiki (bagian 4).

**Kenapa pakai AI simulasi saat demo?** Supaya hasil demo bisa diulang dan tidak ada biaya AI yang bisa
dikuras sebelum pengamanan selesai. Jalur AI sungguhan (Claude) sudah ada di kode.
