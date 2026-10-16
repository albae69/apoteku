import { z } from "zod";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { settings } from "../db/schema";
import { parse } from "../lib/http";
import { setAudit } from "../middleware/audit";
import { requireRole } from "../middleware/auth";

const settingsInput = z.object({
  pharmacyName: z.string().trim().min(1).max(200),
  address: z.string().trim().max(1000).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  npwp: z.string().trim().max(40).optional().or(z.literal("")),
  pharmacistName: z.string().trim().max(200).optional().or(z.literal("")),
  sipaNumber: z.string().trim().max(60).optional().or(z.literal("")),
  taxPercent: z.coerce.number().min(0).max(100).default(0),
  receiptFooter: z.string().trim().max(500).optional().or(z.literal("")),
});

export const settingsRoutes = new Hono();

settingsRoutes.get("/", async (c) => {
  const [row] = await db.select().from(settings).limit(1);
  return c.json({ data: row ?? null });
});

settingsRoutes.put("/", requireRole("owner", "admin"), async (c) => {
  const body = await parse(c, settingsInput);
  const [existing] = await db.select({ id: settings.id }).from(settings).limit(1);
  if (existing) {
    await db.update(settings).set(body).where(eq(settings.id, existing.id));
  } else {
    await db.insert(settings).values(body);
  }
  const [row] = await db.select().from(settings).limit(1);

  setAudit(c, {
    action: "settings.update",
    entity: "settings",
    entityId: existing?.id ?? null,
    detail: { pharmacyName: body.pharmacyName, taxPercent: body.taxPercent },
  });

  return c.json({ data: row });
});
