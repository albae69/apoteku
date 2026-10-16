# Flowchart Apoteku

Diagram alur sistem. Versi Mermaid bisa dirender di VS Code (ekstensi Markdown Preview
Mermaid), GitHub, atau https://mermaid.live.

---

## 1. Arsitektur

```mermaid
flowchart LR
  subgraph Client["Web SPA (browser)"]
    UI["React + Vite<br/>TanStack Router & Query<br/>Tailwind + shadcn-style UI"]
  end

  subgraph Server["API Server"]
    H["Bun + Hono<br/>REST /api"]
    Z["zod validation"]
    D["Drizzle ORM"]
    H --> Z --> D
  end

  DB[("MySQL")]
  SH["@apoteku/shared<br/>schema & tipe"]

  UI -- "HTTP + Bearer JWT" --> H
  H -- "JSON" --> UI
  D --> DB
  SH -. dipakai bersama .- UI
  SH -. dipakai bersama .- H
```

---

## 2. Alur transaksi kasir (POS + shift + struk)

```mermaid
flowchart TD
  A([Login]) --> B{Ada shift aktif?}
  B -- tidak --> C["BUKA SHIFT<br/>input uang awal"]
  C --> D
  B -- ya --> D["KASIR / POS"]
  D --> E["Cari / scan produk"]
  E --> F["Pilih satuan jual<br/>tablet / strip / box"]
  F --> G{Stok cukup?<br/>cek FEFO}
  G -- tidak --> H["Pesan: stok tidak cukup"]
  H --> E
  G -- ya --> I["Tambah ke keranjang"]
  I --> J{Tambah item lain?}
  J -- ya --> E
  J -- tidak --> K["Input metode & jumlah bayar"]
  K --> L{Bayar >= total?}
  L -- tidak --> K
  L -- ya --> M["SIMPAN NOTA (1 transaksi DB)"]
  M --> M1["buat sales + shift_id"]
  M1 --> M2["alokasi FEFO -> potong batches"]
  M2 --> M3["catat stock_movements (sale_out)"]
  M3 --> M4["catat payments"]
  M4 --> M5["tambah poin member"]
  M5 --> N["CETAK STRUK"]
  N --> O{Masih melayani?}
  O -- ya --> D
  O -- tidak --> P["TUTUP SHIFT"]
  P --> P1["input uang fisik dihitung"]
  P1 --> P2["selisih = fisik - (uang awal + tunai)"]
```

---

## 3. Alur pengadaan & stok

```mermaid
flowchart TD
  A["BUAT PO<br/>supplier + item: no.batch, ED, qty, harga"] --> B["status: ordered"]
  B --> C["TERIMA BARANG"]
  C --> D["per item:"]
  D --> D1["buat batch baru (qty, ED, harga pokok)"]
  D1 --> D2["catat stock_movements (purchase_in)"]
  D2 --> D3["update harga pokok produk"]
  D3 --> E["status: received"]
  E --> F["STOK PRODUK NAIK"]
  F --> G{stok <= minimum?}
  G -- ya --> H["ALERT stok rendah"]
  F --> I{ED <= 90 hari?}
  I -- ya --> J["ALERT mendekati kedaluwarsa"]
  F --> K["Dipakai saat penjualan<br/>(FEFO ambil ED terdekat)"]
```

---

## 4. Detail alokasi FEFO

```mermaid
flowchart TD
  A["Penjualan butuh qty X<br/>(satuan dasar)"] --> B["Ambil batch produk<br/>WHERE quantity > 0<br/>ORDER BY ED ASC, id ASC"]
  B --> C{"Ambil dari batch teratas:<br/>take = min(sisa, butuh)"}
  C --> D["kurangi batch<br/>ambil = take"]
  D --> E["catat HPP (costPrice x take)"]
  E --> F{butuh masih > 0?}
  F -- ya --> C
  F -- tidak --> G{"stok total cukup?"}
  G -- tidak --> H["Rollback transaksi<br/>error stok tidak cukup"]
  G -- ya --> I["Lanjut simpan nota"]
```

---

## 5. Model data inti

```mermaid
erDiagram
  users ||--o{ shifts : "membuka"
  users ||--o{ sales : "melayani"
  shifts ||--o{ sales : "menampung"
  customers ||--o{ sales : "membeli"
  doctors ||--o{ prescriptions : "menulis"
  prescriptions ||--o{ prescription_items : "berisi"
  suppliers ||--o{ purchases : "memasok"
  purchases ||--o{ purchase_items : "berisi"
  suppliers ||--o{ batches : "asal"
  products ||--o{ product_units : "punya satuan"
  products ||--o{ batches : "punya batch"
  products ||--o{ sale_items : "terjual"
  products ||--o{ purchase_items : "dibeli"
  batches ||--o{ sale_items : "dialokasikan"
  sales ||--o{ sale_items : "berisi"
  sales ||--o{ payments : "dibayar"
```
