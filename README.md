# Apoteku

Sistem manajemen apotek (MVP) — aplikasi web responsive.

- **Web**: React + Vite + TanStack Router + TanStack Query + Tailwind v4 + shadcn/ui
- **API**: Bun + Hono + Drizzle ORM + MySQL
- **Shared**: zod schemas & types dipakai bersama FE/BE

## Struktur

```
apps/
  api/    # REST API (Bun + Hono + Drizzle)
  web/    # SPA (Vite + React + TanStack Router)
packages/
  shared/ # zod schemas & types
```

## Prasyarat

- Bun >= 1.3
- MySQL 8 / MariaDB (atau `docker compose up -d`)

## Setup

```bash
# 1. Install dependency
bun install

# 2. Siapkan env
cp .env.example .env
cp .env.example apps/api/.env

# 3. Jalankan MySQL (opsional, kalau tidak pakai instance sendiri)
docker compose up -d

# 4. Migrasi + seed
bun run db:migrate
bun run db:seed

# 5. Jalankan dev (API + Web sekaligus)
bun run dev
```

- Web: http://localhost:5173
- API: http://localhost:4000

## Akun seed

| Email              | Password   | Role       |
| ------------------ | ---------- | ---------- |
| owner@apoteku.test | password123 | owner      |
| kasir@apoteku.test | password123 | cashier    |
| apoteker@apoteku.test | password123 | pharmacist |

## Skrip

| Perintah            | Fungsi                                   |
| ------------------- | ---------------------------------------- |
| `bun run dev`       | Jalankan API + Web                       |
| `bun run db:generate` | Generate migrasi dari schema Drizzle   |
| `bun run db:migrate`  | Terapkan migrasi ke MySQL              |
| `bun run db:push`     | Push schema langsung (dev cepat)       |
| `bun run db:seed`     | Isi data contoh                        |
| `bun run typecheck`   | Type check semua workspace             |
| `bun run test:security` | Security test API (23 pemeriksaan)   |
| `bun run test:load`     | Stress test API (baca, login, POS)   |
| `bun run test:audit`    | Verifikasi audit log harian (14 uji) |
| `bun run test:e2e`      | E2E API + browser (butuh stack jalan) |
| `bun run docker:e2e`    | Bangun seluruh stack di Docker & jalankan E2E |

## Audit log harian

Setiap perubahan data dan kejadian autentikasi dicatat ke berkas harian
`apps/api/logs/audit/audit-YYYY-MM-DD.log` (format JSON Lines, satu kejadian per
baris). Berkas lama dihapus otomatis sesuai `AUDIT_RETENTION_DAYS`.

Yang dicatat: waktu, aksi (mis. `sale.create`, `shift.close`, `auth.login`),
aktor (id, nama, email, role), IP, user-agent, entitas yang diubah, hasil
(`success`/`failure`), serta detail relevan. **Password, token, dan secret
tidak pernah ditulis** (kuncinya diredaksi otomatis).

Cakupan default: semua request `POST`/`PUT`/`PATCH`/`DELETE` + login
(sukses/gagal, termasuk yang kena rate limit). Set `AUDIT_LOG_READS=true` bila
ingin ikut mencatat request baca (GET).

Membaca jejak audit via API (hanya owner/admin):

```bash
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/api/audit?date=2026-10-16&action=sale.create&limit=50"
curl -H "Authorization: Bearer <token>" http://localhost:4000/api/audit/days
```

## Shift kasir & cetak struk

- **Shift kasir**: buka shift dengan uang awal, transaksi otomatis tercatat ke shift,
  lalu tutup shift dengan menghitung uang fisik. Sistem menghitung kas seharusnya
  (`uang awal + penjualan tunai`, kembalian tidak dihitung) dan menampilkan selisih.
  Kasir **wajib** membuka shift sebelum bisa bertransaksi.
- **Cetak struk**: struk thermal 80mm dengan pratinjau, bisa dicetak langsung
  (Ctrl/Cmd+P atau tombol Cetak) dari halaman Kasir maupun dari riwayat di halaman
  Transaksi. Nama/alamat apotek dan catatan kaki diambil dari Pengaturan.

## Pengujian (security & stress)

```bash
bun run db:seed
mysql -h 127.0.0.1 -u root -proot apoteku < tools/stress-fixture.sql
bun run dev:api

bun run test:security   # 23 pemeriksaan: JWT, RBAC, injeksi, CORS, rate limit
bun run test:load       # beban baca, login, dan penulisan POS
```

Restart API di antara kedua skrip agar hitungan rate-limit login kembali nol.

Hasil lengkap (temuan, perbaikan, dan perbandingan sebelum/sesudah):
[`docs/qa-report.md`](docs/qa-report.md). Ringkas: **23/23** pemeriksaan keamanan
lulus dan **332.274 request beban tanpa satu pun error**, dengan stok tetap konsisten
(tidak ada oversell / lost update).

## Menjalankan dengan Docker (E2E)

Seluruh stack berjalan di Docker dan diuji end-to-end (API + browser sungguhan):

```bash
bun run docker:e2e        # build + jalankan + uji, lalu berhenti sendiri
bun run docker:e2e:down   # bersihkan container & volume
```

Yang dijalankan `docker-compose.e2e.yml`:

| Service | Isi | Port host |
| --- | --- | --- |
| `mysql` | MySQL 8.4 (healthcheck siap pakai) | — (internal) |
| `api` | `apps/api/Dockerfile` — migrasi + seed otomatis, lalu server Bun/Hono | 4000 |
| `web` | `apps/web/Dockerfile` — nginx menyajikan SPA & mem-proxy `/api` | 8080 |
| `e2e` | `docker/e2e/Dockerfile` — Bun + Chromium (Playwright) | — |

Catatan desain:

- **Satu origin.** Web memanggil API lewat path relatif `/api/...`; nginx mem-proxy ke
  service `api`. Jadi tidak ada CORS dan URL API tidak perlu di-*bake* saat build.
- **MySQL tidak mem-publish port** ke host agar tidak bentrok dengan MySQL/MariaDB lokal.
- `SEED_ON_START=true` membuat setiap kali `up` data uji kembali bersih (deterministik).
- Hasil uji ditulis ke `docs/e2e-result.json`; log audit dari volume bersama ikut diperiksa.

Hasil lengkap (37 pemeriksaan, temuan, dan perbaikannya):
[`docs/e2e-report.md`](docs/e2e-report.md).

Menjalankan E2E saja terhadap stack yang sudah hidup:

```bash
API_BASE=http://localhost:4000 WEB_BASE=http://localhost:8080 bun run test:e2e
```

## Panduan pengguna

Panduan pengguna akhir (bahasa Indonesia) tersedia sebagai PDF:

- [`docs/panduan-pengguna.pdf`](docs/panduan-pengguna.pdf) — hasil jadi (26 halaman, berisi 18 screenshot aplikasi).
- [`docs/panduan-pengguna.tex`](docs/panduan-pengguna.tex) — sumber LaTeX.
- [`docs/images/`](docs/images) — screenshot aplikasi (`*.png`) yang dipakai di dalam panduan.

Membangun ulang PDF (butuh [Tectonic](https://tectonic-typesetting.github.io/) atau
TeX Live apa pun):

```bash
bun run docs:pdf        # setara: tectonic docs/panduan-pengguna.tex --outdir docs
```

Memperbarui screenshot (stack harus hidup, lihat bagian Docker di atas):

```bash
docker compose -f docker-compose.e2e.yml up -d mysql api web
bun run docs:screenshots   # setara: WEB_BASE=http://localhost:8080 bun run tools/screenshots.ts
bun run docs:pdf
```

## Konfigurasi produksi

| Variabel | Default | Keterangan |
| --- | --- | --- |
| `JWT_SECRET` | `dev-secret-change-me` | **Wajib diganti.** API menolak start di production bila masih default. |
| `DB_POOL_SIZE` | `20` | Ukuran connection pool MySQL. |
| `WEB_ORIGIN` | `http://localhost:5173` | Origin yang diizinkan CORS. |
| `DATABASE_URL` | `mysql://root:root@127.0.0.1:3306/apoteku` | Koneksi MySQL. |
| `AUDIT_ENABLED` | `true` | Matikan (`false`) untuk melewati penulisan audit. |
| `AUDIT_DIR` | `apps/api/logs/audit` | Direktori berkas audit harian. |
| `AUDIT_RETENTION_DAYS` | `90` | Umur simpan berkas audit (0 = selamanya). |
| `AUDIT_LOG_READS` | `false` | `true` = permintaan GET juga dicatat. |

Catatan keamanan: login dibatasi 20 percobaan gagal / 15 menit per IP (`429`),
transaksi POS memakai alokasi stok atomik (FEFO) sehingga aman untuk beberapa kasir
serentak, dan transaksi berjalan pada isolation READ COMMITTED.

## Status MVP

Sudah tersedia: master data, inventory (batch + expiry + FEFO), pembelian, penjualan (POS),
resep, shift kasir, cetak struk, dashboard.

Ditunda (fase 2): akuntansi penuh, retur, SATUSEHAT, BPJS, multi-cabang, offline-first.
