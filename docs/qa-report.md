# Laporan Pengujian — Security & Stress Test

Objek uji : API Apoteku (`apps/api`, Bun + Hono + Drizzle + MariaDB 12.3.2)
Target    : `http://localhost:4000` (single node, tanpa latensi jaringan)
Skrip     : `tools/security-test.ts`, `tools/loadtest.ts`
Hasil mentah: `docs/security-result.json`, `docs/loadtest-result.json`

## Ringkasan

| Aspek | Sebelum | Sesudah |
| --- | --- | --- |
| Security check lulus | 16 / 22 | **23 / 23** |
| Temuan risiko tinggi | 2 (RBAC, brute force) | 0 |
| Stress test total error (5xx) | 3.071 dari 282.404 req | **0 dari 332.274 req** |
| Penjualan gagal saat 50 kasir serentak | 19% (5xx) + 71% (stok uji habis) | **0%** |
| Konsistensi data | stok tidak negatif | stok tidak negatif, nota = item = pembayaran = mutasi |
| Audit log | tidak ada | **harian berbasis file, 14 / 14 uji lulus** |
| E2E Docker (API + browser) | halaman daftar crash di browser | **37 / 37 lulus** ([`e2e-report.md`](e2e-report.md)) |

---

## Cara menjalankan

```bash
# 1. Siapkan data uji
bun run db:seed
mysql -h 127.0.0.1 -u root -proot apoteku < tools/stress-fixture.sql

# 2. Jalankan API
bun run dev:api

# 3. Security test
bun run test:security

# 4. Stress test  (restart API dulu agar hitungan rate-limit kembali nol)
bun run test:load

# 5. Audit log  (14 pemeriksaan)
bun run test:audit
```

Opsi stress test lewat env: `BASE`, `DUR` (ms per skenario), `CONC` (konkurensi), `ONLY` (satu skenario).

---

## A. Security Test

23 pemeriksaan, semuanya **PASS**. Cakupan: autentikasi/JWT, otorisasi/RBAC, IDOR,
injeksi SQL, mass assignment, kebocoran data/error, CORS, security headers, dan rate limiting.

### Temuan awal dan perbaikannya

| Kode | Risiko | Temuan sebelum | Perbaikan | File |
| --- | --- | --- | --- | --- |
| `INJ-03` | Sedang | `GET /api/products/1 OR 1=1` → **500**, log: ``Unknown column 'NaN' in 'WHERE'``. `Number("abc")` = `NaN` ikut dikirim ke SQL. | Helper `parseId()` memvalidasi id bilangan bulat positif → 400; dipakai di semua route `/:id` (products, purchases, sales, prescriptions, shifts, CRUD master). | `lib/http.ts`, `routes/*` |
| `RBAC-01` | **Tinggi** | Kasir bisa **mengubah pengaturan apotek** (200, nama apotek berubah). | `requireRole("owner","admin")` pada `PUT /settings`. | `routes/settings.ts` |
| `RBAC-02` | Sedang | Kasir bisa **menghapus master data** (200). | Parameter `writeRoles` pada CRUD generik; guard diterapkan hanya untuk method selain GET/HEAD sehingga pembacaan tetap terbuka. | `lib/crud.ts`, `routes/master.ts` |
| | | | Kebijakan: master & katalog → owner/admin/pharmacist; data pelanggan → semua role (kasir boleh mendaftarkan member). | `routes/master.ts`, `routes/products.ts`, `routes/purchases.ts`, `routes/inventory.ts`, `routes/prescriptions.ts` |
| `IDOR-01` | Sedang | Kasir bisa **menutup shift milik kasir lain** (200). | `POST /shifts/:id/close` memeriksa kepemilikan (`shift.userId === user.id` atau role `owner`) → 403. | `routes/shifts.ts` |
| `HDR-01` | Rendah | Tidak ada security header sama sekali. | `hono/secure-headers` + CSP eksplisit (`default-src 'self'; base-uri 'self'; frame-ancestors 'none'`). | `src/index.ts` |
| `RATE-01` | **Tinggi** | 30 percobaan login gagal diproses semua (tidak ada limit) → brute force. | Rate limiter in-memory: maksimum **20 percobaan gagal / 15 menit per IP**; login sukses tidak dihitung (`refund`); respons 429 + header `Retry-After`. | `middleware/rate-limit.ts`, `routes/auth.ts` |

### Yang sudah baik sejak awal (tidak perlu perbaikan)

- Token tanpa signature valid, `alg=none`, signature diubah, secret salah, dan token kedaluwarsa → semuanya **401**.
- Password di-hash **Argon2id** (`Bun.password`), tidak pernah ikut dalam respons.
- Semua query lewat Drizzle (prepared statement) — injeksi `' OR 1=1 --` dan `'; DROP TABLE products; --` tidak berdampak.
- Validasi input berbasis zod (mass assignment `id`/`role` diabaikan).
- Error 500 tidak membocorkan detail SQL/stack trace ke klien.
- CORS hanya mengizinkan `WEB_ORIGIN`; origin asing tidak mendapat header CORS.

### Sisa risiko (belum ditangani, perlu keputusan produk)

1. **JWT tidak bisa dicabut** — masa berlaku 12 jam, tanpa refresh token/blacklist. Logout hanya menghapus token di klien.
2. **Rate limiter in-memory** — hilang saat server restart dan tidak berlaku lintas instance. Bila nanti multi-instance, pindahkan ke Redis.
3. **Kebijakan password lemah** — validasi hanya `min(1)`; perkuat jadi minimal 8 karakter + cek password umum.
4. **Pembatasan baca per role** — semua user terautentikasi dapat membaca seluruh transaksi & angka keuangan. Untuk apotek tunggal ini wajar, tapi perlu ditinjau bila menambah role/karyawan.
5. **`JWT_SECRET` default** — aplikasi kini menolak start di production bila masih `dev-secret-change-me`, tetapi secret harus tetap dirotasi.
6. **Monitoring error** — log `[unhandled]` hanya ke stdout, belum terstruktur/terkirim ke layanan monitoring.
7. **Audit log berbasis file** — hanya bisa dibaca lokal di server (dan via API oleh owner/admin); belum dikirim ke penyimpanan terpusat/immutable seperti WORM atau SIEM.

---

## B. Stress Test

Setiap skenario berjalan 8 detik pada konkurensi 50
(kecuali `auth:login` c=10 dan ramp 1→200). Total **332.274 request, 0 error**.

### Hasil akhir

| Skenario | Conc | Req | RPS | p50 | p90 | p95 | p99 | max | 4xx | 5xx | err |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| read:products-list | 50 | 47.008 | 5.872,6 | 8,1 | 9,5 | 10,6 | 20,4 | 48,2 | 0 | 0 | 0 |
| read:product-lookup | 50 | 49.022 | 6.124,3 | 7,7 | 9,3 | 10,6 | 15,9 | 39,4 | 0 | 0 | 0 |
| read:inventory-stock | 50 | 98.283 | 12.281,2 | 4,0 | 5,0 | 5,2 | 8,5 | 30,1 | 0 | 0 | 0 |
| read:dashboard | 50 | 28.311 | 3.536,0 | 14,0 | 15,1 | 15,7 | 18,7 | 34,4 | 0 | 0 | 0 |
| auth:login | 10 | 751 | 93,0 | 104,7 | 127,1 | 134,9 | 162,7 | 231,9 | 0 | 0 | 0 |
| **write:sale-create** | 50 | 11.925 | 1.487,9 | 31,7 | 44,1 | 48,1 | 59,7 | 83,5 | **0** | **0** | 0 |
| ramp c=1 | 1 | 7.763 | 1.940,5 | 0,4 | 0,7 | 1,4 | 3,7 | 12,1 | 0 | 0 | 0 |
| ramp c=10 | 10 | 22.136 | 5.532,7 | 1,7 | 2,3 | 2,7 | 3,7 | 19,7 | 0 | 0 | 0 |
| ramp c=50 | 50 | 23.334 | 5.827,7 | 8,3 | 9,3 | 9,9 | 11,7 | 41,9 | 0 | 0 | 0 |
| ramp c=100 | 100 | 22.362 | 5.578,2 | 17,6 | 19,1 | 20,5 | 31,4 | 55,0 | 0 | 0 | 0 |
| ramp c=200 | 200 | 21.379 | 5.305,8 | 36,5 | 40,5 | 43,0 | 72,5 | 146,0 | 0 | 0 | 0 |

Catatan: latensi dalam milidetik. `read:inventory-stock` tercepat karena agregasi
`GROUP BY` ditangani penuh oleh MySQL; `read:dashboard` paling lambat karena banyak
subquery agregat. Endpoint baca ~5.300–12.300 req/s; penulisan transaksional POS
~1.490 req/s pada 50 kasir serentak (jauh di atas kebutuhan apotek sungguhan).

### Perbandingan sebelum vs sesudah perbaikan

| Skenario | Sebelum (req/s · p99) | Sesudah (req/s · p99) | 5xx sebelum → sesudah |
| --- | --- | --- | --- |
| read:products-list | 6.205 · 11,8 ms | 5.873 · 20,4 ms | 0 → 0 |
| read:inventory-stock | 12.737 · 6,7 ms | 12.281 · 8,5 ms | 0 → 0 |
| read:dashboard | 3.325 · 31,0 ms | 3.536 · 18,7 ms | 0 → 0 |
| auth:login | 88 · 462 ms (c=20) | 93 · 163 ms (c=10) | 0 → 0 |
| write:sale-create | 2.670¹ · 45,4 ms | 1.488 · 59,7 ms | **3.071 → 0** |

¹ RPS "sebelum" menipu: mayoritas request gagal cepat (stok uji habis / error DB),
sehingga terlihat lebih tinggi. Angka sesudah adalah throughput nyata yang semuanya sukses.

### Akar masalah yang ditemukan

**1. `ER_CHECKREAD` — "Record has changed since last read in table 'batches'" (risiko tinggi)**

- Gejala: 3.071 dari 16.048 request POS gagal **500** di bawah beban serentak.
- Penyebab: alur FEFO melakukan *baca lalu tulis* (`SELECT` stok → `UPDATE` stok) di dalam
  transaksi. Pada isolation **REPEATABLE READ** bawaan MySQL, `UPDATE` yang menyentuh baris
  yang sudah diubah transaksi lain setelah snapshot dibuat gagal — ini proteksi terhadap
  *lost update*, tetapi memunculkan 500.
- Percobaan pertama (`SELECT ... FOR UPDATE`) **memperburuk** keadaan (9.457 error) karena
  MariaDB juga melaporkan `ER_CHECKREAD` pada locking read.
- Perbaikan final (tiga lapis):
  1. **READ COMMITTED** per koneksi pool — `UPDATE` mengevaluasi ulang kondisi terhadap versi baris terbaru.
  2. **Atomic compare-and-set**:
     `UPDATE batches SET quantity = quantity - ? WHERE id = ? AND quantity >= ?`.
     Tidak ada lagi baca-lalu-tulis; dua transaksi tidak dapat menjual stok yang sama.
  3. **Retry** `withRetry()` (6 percobaan, jeda kecil berjitter) untuk deadlock/`ER_CHECKREAD`;
     bila tetap gagal, dikembalikan sebagai **409** (minta kasir ulangi), bukan 500.
- Dampak tambahan: `connectionLimit` MySQL dibuat konfigurabel (`DB_POOL_SIZE`, default 20, sebelumnya 10).

**2. Duplikat kode nota (`ER_DUP_ENTRY`)**

- Gejala: 42 request gagal 500 pada kolom unik `sales.code`.
- Penyebab: sufiks acak `Math.random().toString(36).slice(2,6)` hanya ~4 karakter
  (≈1,7 juta kombinasi) — pada 12.000 nota/hari, tabrakan praktis pasti terjadi.
- Perbaikan: sufiks **6 karakter** berbasis `crypto.getRandomValues` (≈2,2 miliar kombinasi),
  dan `ER_DUP_ENTRY` diperlakukan sebagai error yang layak dicoba ulang.

### Bukti integritas data (setelah beban puncak)

```
sales = 11.925   sale_items = 11.925   payments = 11.925
stock_movements(sale_out) = 11.925      batch negatif = 0
kode nota ganda = 0
omzet = 59.625.000  =  11.925 × 5.000  (tepat, tidak ada penjualan hilang/ganda)
```

Empat tabel bernilai identik dan stok tidak pernah negatif → **tidak ada oversell
maupun lost update** pada stok meski 50 kasir menekan tombol pada saat yang sama.

---

## C. Audit Log (implementasi baru)

Audit log harian berbasis file ditambahkan setelah sisa risiko sebelumnya
mencatat "belum ada audit log". Implementasi:

- **Berkas harian**: `apps/api/logs/audit/audit-YYYY-MM-DD.log`, format JSON Lines,
  satu kejadian per baris, ditulis append-only dan di-*flush* setiap kejadian agar
  isi tidak hilang bila proses berhenti mendadak.
- **Cakupan**: semua request `POST`/`PUT`/`PATCH`/`DELETE`, ditambah login
  sukses/gagal (termasuk yang ditolak rate limit `429`). Handler dapat memperkaya
  catatan lewat `setAudit()` — dipakai pada `sale.create`, `shift.open`,
  `shift.close`, `settings.update`, `inventory.adjust`, dan `auth.login`.
- **Isi**: waktu, aksi, aktor (id/nama/email/role), IP, user-agent, metode/path,
  status, durasi, entitas + id, hasil, dan detail relevan.
- **Keamanan**: kunci sensitif (`password`, `token`, `secret`, `authorization`,
  `otp`, `pin`) diredaksi otomatis; nilai panjang dipotong. Parameter tanggal
  divalidasi ketat sehingga tidak bisa dipakai untuk membaca berkas lain
  (path traversal).
- **Retensi**: berkas lebih tua dari `AUDIT_RETENTION_DAYS` dihapus otomatis.
- **Akses**: hanya `owner`/`admin` yang bisa membaca via
  `GET /api/audit?date=&action=&event=&outcome=&userId=&limit=` dan
  `GET /api/audit/days`; role lain menerima `403`.

### Hasil verifikasi (`bun run test:audit`)

```
Total: 14 · Lolos: 14 · Gagal: 0
```

Mencakup: login sukses/gagal, penjualan, buka/tutup shift, penyesuaian stok,
perubahan pengaturan, validitas berkas JSONL, filter, hak akses, dan penolakan
path traversal. Detail mentah: [`audit-result.json`](audit-result.json).

### Dampak performa

Audit ditulis pada setiap request yang mengubah data, jadi diuji ulang di bawah
beban. Throughput penjualan **tidak berubah berarti**:

| Skenario (conc 50) | Sebelum audit | Dengan audit | 5xx |
| --- | --- | --- | --- |
| `write:sale-create` | 1.487,9 req/s · p99 59,7 ms | **1.505,7 req/s · p99 53,6 ms** | 0 |

Pada uji ulang beban penuh, 12.068 penjualan + 740 login terekam menjadi 12.809
baris / 6,0 MB, tetap **0 error** dan integritas data utuh (12.068 = 12.068 =
12.068 = 12.068).

---

## D. Catatan metodologi & keterbatasan

- Pengujian hanya pada **satu node** di localhost, tanpa latensi jaringan dan tanpa
  query bersaing dari web app. Angka di atas adalah batas atas praktis.
- `auth:login` dibatasi ~93 req/s karena verifikasi **Argon2id** murni CPU-bound.
  Ini perilaku yang diinginkan (sengaja lambat), bukan kemacetan.
- Penulisan POS dibatasi oleh serialisasi pada baris batch produk yang sama
  (target throughput realistis apotek: puluhan transaksi per menit, bukan per detik).
- Stress test memakai fixture `tools/stress-fixture.sql` (2 juta unit/produk) supaya
  kegagalan yang terukur murni berasal dari konkurensi, bukan dari stok uji yang habis.
- Security test bersifat *black-box*: memanggil API seperti klien biasa, tanpa akses
  ke internal proses.

---

## E. E2E di Docker

Seluruh stack dijalankan di Docker (MySQL + API + Web nginx + runner Chromium) dan
diuji end-to-end lewat API **dan** browser sungguhan:

```bash
bun run docker:e2e
```

E2E ini menemukan **bug nyata di UI** yang tidak terlihat oleh uji API: seluruh
halaman daftar jatuh ke error boundary karena kontrak `api()`/`apiList()` — sudah
diperbaiki. Rincian lengkap: [`docs/e2e-report.md`](e2e-report.md).
