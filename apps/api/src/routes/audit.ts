import { Hono } from "hono";
import { localDate } from "../lib/code";
import { listAuditDays, readAudit } from "../lib/audit";
import { badRequest } from "../lib/http";
import { requireRole } from "../middleware/auth";

/**
 * Pembacaan jejak audit. Hanya owner/admin — isi log memuat aktivitas
 * seluruh pengguna (termasuk percobaan login).
 */
export const auditRoutes = new Hono();

auditRoutes.use("*", requireRole("owner", "admin"));

/** Daftar berkas audit harian yang tersedia. */
auditRoutes.get("/days", (c) => c.json({ data: listAuditDays() }));

/**
 * Kejadian audit satu hari.
 * Query: `date=YYYY-MM-DD` (default hari ini), `limit`, `action`, `event`,
 * `outcome`, `userId`.
 */
auditRoutes.get("/", async (c) => {
  const date = c.req.query("date") ?? localDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest("Format tanggal harus YYYY-MM-DD");
  }

  const rawLimit = Number(c.req.query("limit") ?? 200);
  const rawUserId = c.req.query("userId");

  const data = await readAudit(date, {
    limit: Number.isFinite(rawLimit) ? rawLimit : 200,
    action: c.req.query("action") || undefined,
    event: c.req.query("event") || undefined,
    outcome: c.req.query("outcome") || undefined,
    userId: rawUserId && Number.isInteger(Number(rawUserId)) ? Number(rawUserId) : undefined,
  });

  return c.json({ data, meta: { date, count: data.length } });
});
