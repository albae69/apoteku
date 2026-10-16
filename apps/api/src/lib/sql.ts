import { sql } from "drizzle-orm";

/**
 * Subquery korelasi butuh nama tabel yang eksplisit.
 * Drizzle merender `${kolom}` di dalam template `sql` TANPA kualifikasi tabel,
 * sehingga di subquery bisa salah resolusi (ambigu). Semua subquery di sini
 * ditulis dengan identifier lengkap.
 */

/** Total stok tersedia per produk (jumlah semua batch dengan qty > 0). */
export const productStock = () =>
  sql<number>`coalesce((
    select sum(b.quantity) from batches b
    where b.product_id = products.id and b.quantity > 0
  ), 0)`.mapWith(Number);

/** Nilai persediaan (qty tersisa x harga pokok batch). */
export const inventoryValue = () =>
  sql<number>`coalesce((
    select sum(b.quantity * b.cost_price) from batches b
    where b.quantity > 0
  ), 0)`.mapWith(Number);

/** Jumlah baris anak untuk relasi one-to-many, mis. hitung item transaksi. */
export const childCount = (table: string, fk: string, parent: string) =>
  sql<number>`(select count(*) from ${sql.raw(table)} c where c.${sql.raw(
    fk,
  )} = ${sql.raw(parent)}.id)`.mapWith(Number);
