import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./env";
import { closeAudit } from "./lib/audit";
import { errorHandler } from "./lib/http";
import { audit } from "./middleware/audit";
import { registerRoutes } from "./routes";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  // Header keamanan dasar; CSP eksplisit meski API hanya menyajikan JSON.
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
  }),
);
app.use(
  "*",
  cors({
    origin: env.webOrigin,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  }),
);

// Audit log: mencatat perubahan data & autentikasi (lihat middleware/audit.ts).
app.use("*", audit);

app.onError(errorHandler);
registerRoutes(app);

// Tutup buffer file audit lalu keluar seperti perilaku default.
// (Menambah listener SIGTERM/SIGINT menggantikan perilaku berhenti bawaan,
// jadi `process.exit` harus dipanggil eksplisit.)
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    closeAudit();
    process.exit(0);
  });
}

console.log(`API Apoteku berjalan di http://localhost:${env.port}`);

export default {
  port: env.port,
  fetch: app.fetch,
};
