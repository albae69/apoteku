import { migrate } from "drizzle-orm/mysql2/migrator";
import { db, pool } from "./index";

console.log("Menjalankan migrasi...");
await migrate(db, { migrationsFolder: "./drizzle" });
console.log("Migrasi selesai.");
await pool.end();
process.exit(0);
