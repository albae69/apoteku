import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "../env";
import * as schema from "./schema";

export const pool = mysql.createPool({
  uri: env.databaseUrl,
  connectionLimit: env.dbPoolSize,
  waitForConnections: true,
  decimalNumbers: true,
});

/**
 * Jalankan transaksi pada isolation READ COMMITTED (bukan REPEATABLE READ
 * bawaan MySQL). Pada beban bersamaan, REPEATABLE READ membuat UPDATE/DELETE
 * yang menyentuh baris yang baru saja diubah transaksi lain gagal dengan
 * ER_CHECKREAD ("Record has changed since last read"); READ COMMITTED
 * mengevaluasi ulang kondisi terhadap versi baris terbaru.
 */
pool.on("connection", (connection) => {
  connection.query("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED");
});

export const db = drizzle(pool, { schema, mode: "default" });

export type DB = typeof db;
export { schema };
