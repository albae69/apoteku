# Laporan E2E — Docker (API + Browser)

Objek uji : **seluruh stack** Apoteku yang berjalan di Docker
            (MySQL 8.4 + API Bun/Hono + Web nginx + runner Playwright/Chromium)
Perintah  : `bun run docker:e2e`
Skrip     : `tools/e2e.ts` → `tools/e2e-api.ts`, `tools/e2e-browser.ts`
Hasil mentah: `docs/e2e-result.json`

## Ringkasan

| Lapisan | Pemeriksaan | Lolos | Gagal |
| --- | --- | --- | --- |
| API (perjalanan bisnis lewat HTTP) | 23 | **23** | 0 |
| Browser (Chromium, UI sungguhan) | 14 | **14** | 0 |
| **Total** | **37** | **37** | **0** |

E2E ini bukan sekadar mengulang uji API: ia menjalankan **perjalanan pengguna
yang sesungguhnya** di dalam container, dari membuka aplikasi di browser,
membuka shift, menjual obat, mencetak struk, sampai menutup sesi.

## Arsitektur stack uji

`docker-compose.e2e.yml` menjalankan empat service:

| Service | Isi | Port host |
| --- | --- | --- |
| `mysql` | MySQL 8.4 + healthcheck | — (hanya jaringan internal) |
| `api` | `apps/api/Dockerfile` — migrasi + seed otomatis, lalu server Bun/Hono | 4000 |
| `web` | `apps/web/Dockerfile` — nginx menyajikan SPA & mem-proxy `/api` | 8080 |
| `e2e` | `docker/e2e/Dockerfile` — Bun + Chromium (Playwright) | — |

Keputusan desain penting:

- **Satu origin.** Web memanggil API lewat path relatif `/api/...`, lalu nginx
  mem-proxy ke service `api`. Tidak ada CORS, dan URL API tidak perlu di-*bake*
  saat build (`VITE_API_URL=""`). Diuji oleh `E2E-B03`.
- **MySQL tidak mem-publish port** ke host, supaya tidak bentrok dengan
  MySQL/MariaDB lokal di mesin pengembang.
- `SEED_ON_START=true` membuat setiap kali `up` data uji kembali bersih, sehingga
  hasil deterministik dan migrasi selalu diuji dari database kosong.
- Audit log & hasil uji dipertukarkan lewat **volume bersama** antar container.
- Hasil uji ditulis ke `docs/e2e-result.json` (mount `./docs`).

## Cara menjalankan

```bash
bun run docker:e2e        # build + up + uji; container berhenti sendiri
bun run docker:e2e:down   # bersihkan container & volume
```

Menjalankan E2E terhadap stack yang sudah hidup (di host):

```bash
API_BASE=http://localhost:4000 WEB_BASE=http://localhost:8080 bun run test:e2e
```

Hanya satu lapisan:

```bash
bun run test:e2e:api
bun run test:e2e:browser
```

## A. E2E API — perjalanan bisnis (23 pemeriksaan)

Urutannya sengaja meniru alur kerja apotek sungguhan.

| Kode | Yang diuji |
| --- | --- |
| A01 | API sehat (`/health`) |
| A02 | Login tiga role berhasil, password salah ditolak (401) |
| A03 | RBAC: kasir ditolak (403), owner boleh membuat produk (201) |
| A04 | Master data terbentuk (supplier oleh owner, pelanggan oleh kasir) |
| A05 | Produk multi-satuan tersimpan & terbaca kembali |
| A06 | Pembelian diterima → batch baru & stok bertambah |
| A07 | Peringatan kedaluwarsa mendeteksi batch yang habis dalam 25 hari |
| A08 | Penyesuaian stok (opname −2) tercatat di kartu stok |
| A09 | Kasir membuka shift dengan uang awal Rp200.000 |
| A10 | Transaksi ditolak (409) bila shift belum dibuka |
| A11 | **FEFO**: batch dengan kedaluwarsa terdekat terpakai lebih dulu |
| A12 | Hitung nota benar (subtotal/total/kembalian) |
| A13 | Jual 1 strip = 10 tablet (konversi satuan) & stok turun 10 |
| A14 | Pembayaran kurang dari total ditolak (400) |
| A15 | Stok tidak mencukupi ditolak & transaksi di-rollback (stok tetap) |
| A16 | Pembayaran non-tunai (QRIS) tercatat pada nota |
| A17 | Resep dapat dibuat kasir dan dibaca apoteker |
| A18 | Dashboard mencerminkan penjualan hari ini (jumlah & omzet cocok) |
| A19 | Rekonsiliasi kas: total, tunai, non-tunai, selisih Rp5.000 tepat |
| A19b | Shift yang sudah ditutup tidak bisa ditutup lagi (409) |
| A20 | Audit harian merekam seluruh perjalanan & tidak membocorkan rahasia |
| A21 | **10 transaksi serentak** memperebutkan stok 5 → tepat 5 sukses, sisa 0 |
| A21b | Semua kode nota unik (tidak ada duplikasi di bawah konkurensi) |

## B. E2E Browser — UI sungguhan (14 pemeriksaan)

Chromium headless menekan tombol yang sama seperti kasir.

| Kode | Yang diuji |
| --- | --- |
| B01 | Web tersaji nginx & aplikasi React dimuat |
| B02 | Login lewat form berhasil & shell tampil sebagai kasir |
| B03 | Semua permintaan API satu origin (tidak ada panggilan ke :4000) |
| B04 | Membuka shift dari UI → layar kasir siap |
| B05 | Pencarian produk menampilkan hasil secara langsung |
| B06 | Menambah 3 tablet → total Rp2.100 |
| B07 | Kembalian dihitung otomatis (Rp5.000 − Rp2.100 = Rp2.900) |
| B08 | Transaksi tersimpan dari UI dan nota dibuat |
| B09 | Struk 80mm memuat nama apotek, nomor nota, dan total |
| B10 | Nota baru muncul di riwayat transaksi |
| B11 | Halaman shift menampilkan shift terbuka + uang awal |
| B12 | Deep link SPA (`/inventory`) dilayani nginx tanpa 404 |
| B13 | **Semua 8 halaman** terbuka tanpa error boundary |
| B14 | Logout kembali ke halaman masuk |

## C. Temuan & perbaikan

### C1. Semua halaman daftar crash di browser (risiko tinggi)

**Gejala.** Membuka `/pos`, `/products`, `/purchases`, dan halaman daftar lain
menampilkan *“Something went wrong!”* — React error boundary.

**Akar masalah.** `api()` di `apps/web/src/lib/api.ts` selalu membuka pembungkus
respons:

```ts
return (json?.data ?? json) as T;
```

Padahal **14 pemanggil** justru mengharapkan pembungkus `{ data, meta }` tetap
utuh (mereka memakai `xxx.data.data` / `xxx.data.meta.total`) — mis. `/products`,
`/purchases`, `/prescriptions`, `/inventory/stock`, `/sales`, `/shifts`,
`/master/customers`. Akibatnya `.data.data` bernilai `undefined` lalu `.map(...)`
melempar `TypeError`. Ini juga membuat paginasi (`meta.total`) mustahil dipakai.

**Perbaikan.** Kontrak klien dipecah menjadi eksplisit:

```ts
/** Objek tunggal: pembungkus `{ data }` dibuka. `{ data: null }` → null. */
export async function api<T>(...): Promise<T>

/** Daftar: isi respons `{ data, meta }` dikembalikan apa adanya. */
export async function apiList<T>(...): Promise<T>
```

14 pemanggil daftar diganti ke `apiList`. Ditambah perbaikan `{ data: null }`
yang sebelumnya mengembalikan objek pembungkus (truthy).

**Dampak sampingan yang ikut sembuh.** Gerbang shift di POS adalah
`if (!shift.data)`. Karena `{ data: null }` dulu menjadi objek truthy, kartu
*“Buka shift dulu”* **tidak pernah muncul** meski kasir belum membuka shift.
Setelah perbaikan, gerbang itu bekerja (dibuktikan `E2E-B04`).

**Bukti.**

| | Sebelum | Sesudah |
| --- | --- | --- |
| `/pos` | `Something went wrong!` | layar kasir tampil |
| `/products` | `Something went wrong!` | 6 produk tampil |
| Semua 8 halaman (B13) | gagal | **seluruh halaman sehat** |

Validasi kompilasi: `bun run typecheck` (3 workspace) dan `bun run build` hijau.

### C2. Build Docker menggantung (masalah infrastruktur)

**Gejala.** `docker compose build` berhenti tanpa output selama >15 menit di
langkah `resolve image config for docker.io/docker/dockerfile:1`.

**Akar masalah.** Direktif `# syntax=docker/dockerfile:1` memaksa Docker menarik
*frontend* Dockerfile dari Docker Hub; proses itu menggantung di lingkungan ini.
Direktif tersebut tidak diperlukan karena Dockerfile hanya memakai sintaks
standar (multi-stage, `COPY --from`, `ENV`, `RUN`).

**Perbaikan.** Direktif dihapus dari ketiga Dockerfile. Selain itu cache BuildKit
sempat rusak (`parent snapshot ... does not exist`) dan dibersihkan dengan
`docker builder prune -af`.

**Pelajaran.** Jangan tambahkan `# syntax=...` kecuali memang butuh fitur
frontend khusus; itu menambah ketergantungan jaringan pada setiap build.

### C3. Assertion uji yang rawan (bukan bug produk)

`E2E-B10` sempat gagal karena memeriksa elemen dua kali (race). Diganti menjadi
polling teks halaman + membaca isi tabel, sekaligus menampilkan isi tabel pada
detail bila gagal. Sekarang lulus konsisten.

## D. Metodologi & keterbatasan

- Browser uji berjalan **headless**; `window.print()` dinonaktifkan (tidak ada
  dialog cetak di headless), tetapi **isi struk** tetap diverifikasi dari DOM.
- Log audit diperiksa lewat volume bersama, bukan lewat API, untuk membuktikan
  berkas benar-benar tertulis di disk.
- Sebelum uji, dataset di-*seed* ulang sehingga hasil deterministik.
- Belum dicakup: retur penjualan, laporan periode + ekspor CSV, dan alur
  multi-cabang (fase 2).
