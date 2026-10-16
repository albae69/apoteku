/**
 * Konfigurasi runtime API. Bun otomatis memuat file .env.
 */
import { join } from "node:path";

export const env = {
  port: Number(process.env.PORT ?? 4000),
  databaseUrl:
    process.env.DATABASE_URL ?? "mysql://root:root@127.0.0.1:3306/apoteku",
  jwtSecret: process.env.JWT_SECRET ?? "dev-secret-change-me",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  isProduction: process.env.NODE_ENV === "production",
  /** Ukuran connection pool MySQL (naikkan bila banyak kasir bersamaan). */
  dbPoolSize: Number(process.env.DB_POOL_SIZE ?? 20),

  /** Audit log harian berbasis file. */
  auditEnabled: process.env.AUDIT_ENABLED !== "false",
  /** Direktori berkas audit (satu file per hari: audit-YYYY-MM-DD.log). */
  auditDir: process.env.AUDIT_DIR ?? join(process.cwd(), "logs", "audit"),
  /** Umur simpan berkas audit (hari). 0 = simpan selamanya. */
  auditRetentionDays: Number(process.env.AUDIT_RETENTION_DAYS ?? 90),
  /** Bila true, permintaan baca (GET) juga dicatat. Default: hanya perubahan data & autentikasi. */
  auditLogReads: process.env.AUDIT_LOG_READS === "true",
} as const;

if (env.isProduction && env.jwtSecret === "dev-secret-change-me") {
  throw new Error(
    "JWT_SECRET masih memakai nilai default. Set JWT_SECRET yang kuat sebelum production.",
  );
}
