import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { prescriptionInput } from "@apoteku/shared";
import { db } from "../db";
import {
  customers,
  doctors,
  prescriptionItems,
  prescriptions,
  products,
} from "../db/schema";
import { CODE_PREFIX, generateCode } from "../lib/code";
import { insertIdOf, notFound, parse, parseId } from "../lib/http";
import { childCount } from "../lib/sql";
import { requireRole } from "../middleware/auth";

export const prescriptionRoutes = new Hono();

/** Resep boleh dibuat kasir (input di loket) maupun apoteker. */
const prescriptionWrite = requireRole("owner", "admin", "pharmacist", "cashier");

prescriptionRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      ...getTableColumns(prescriptions),
      customerName: customers.name,
      doctorName: doctors.name,
      itemCount: childCount("prescription_items", "prescription_id", "prescriptions"),
    })
    .from(prescriptions)
    .leftJoin(customers, eq(prescriptions.customerId, customers.id))
    .leftJoin(doctors, eq(prescriptions.doctorId, doctors.id))
    .orderBy(desc(prescriptions.createdAt))
    .limit(200);
  return c.json({ data: rows });
});

prescriptionRoutes.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const [rx] = await db
    .select({
      ...getTableColumns(prescriptions),
      customerName: customers.name,
      doctorName: doctors.name,
    })
    .from(prescriptions)
    .leftJoin(customers, eq(prescriptions.customerId, customers.id))
    .leftJoin(doctors, eq(prescriptions.doctorId, doctors.id))
    .where(eq(prescriptions.id, id))
    .limit(1);
  if (!rx) throw notFound();
  const items = await db
    .select({
      ...getTableColumns(prescriptionItems),
      productName: products.name,
    })
    .from(prescriptionItems)
    .leftJoin(products, eq(prescriptionItems.productId, products.id))
    .where(eq(prescriptionItems.prescriptionId, id));
  return c.json({ data: { ...rx, items } });
});

prescriptionRoutes.post("/", prescriptionWrite, async (c) => {
  const body = await parse(c, prescriptionInput);
  const user = c.get("user");

  const id = await db.transaction(async (tx) => {
    const res = await tx.insert(prescriptions).values({
      code: generateCode(CODE_PREFIX.prescription),
      customerId: body.customerId ?? null,
      doctorId: body.doctorId ?? null,
      patientName: body.patientName,
      status: "pending",
      note: body.note || null,
      userId: user.id,
    });
    const prescriptionId = insertIdOf(res);
    await tx.insert(prescriptionItems).values(
      body.items.map((it) => ({
        prescriptionId,
        productId: it.productId ?? null,
        name: it.name || "Obat",
        quantity: it.quantity,
        signa: it.signa || null,
        note: it.note || null,
      })),
    );
    return prescriptionId;
  });

  return c.json({ data: { id } }, 201);
});

prescriptionRoutes.patch("/:id/status", prescriptionWrite, async (c) => {
  const id = parseId(c.req.param("id"));
  const body = await parse(
    c,
    z.object({ status: z.enum(["pending", "dispensed", "cancelled"]) }),
  );
  await db.update(prescriptions).set({ status: body.status }).where(eq(prescriptions.id, id));
  return c.json({ success: true });
});
