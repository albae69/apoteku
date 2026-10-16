import { desc, eq, getTableColumns, sql } from "drizzle-orm";
import { Hono } from "hono";
import { purchaseReceiveInput, purchaseInput } from "@apoteku/shared";
import { db } from "../db";
import {
  batches,
  products,
  purchaseItems,
  purchases,
  stockMovements,
  suppliers,
} from "../db/schema";
import { CODE_PREFIX, generateCode, localDate } from "../lib/code";
import { badRequest, conflict, insertIdOf, notFound, parse, parseId } from "../lib/http";
import { childCount } from "../lib/sql";
import { requireRole } from "../middleware/auth";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const purchaseRoutes = new Hono();

/** Pengadaan barang hanya untuk owner/admin/apoteker. */
const purchaseWrite = requireRole("owner", "admin", "pharmacist");

purchaseRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      ...getTableColumns(purchases),
      supplierName: suppliers.name,
      itemCount: childCount("purchase_items", "purchase_id", "purchases"),
    })
    .from(purchases)
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .orderBy(desc(purchases.createdAt))
    .limit(200);
  return c.json({ data: rows });
});

purchaseRoutes.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const [po] = await db
    .select({
      ...getTableColumns(purchases),
      supplierName: suppliers.name,
    })
    .from(purchases)
    .leftJoin(suppliers, eq(purchases.supplierId, suppliers.id))
    .where(eq(purchases.id, id))
    .limit(1);
  if (!po) throw notFound();
  const items = await db
    .select({
      ...getTableColumns(purchaseItems),
      productName: products.name,
      baseUnit: products.baseUnit,
    })
    .from(purchaseItems)
    .innerJoin(products, eq(purchaseItems.productId, products.id))
    .where(eq(purchaseItems.purchaseId, id));
  return c.json({ data: { ...po, items } });
});

purchaseRoutes.post("/", purchaseWrite, async (c) => {
  const body = await parse(c, purchaseInput);
  const user = c.get("user");

  const items = body.items.map((it) => ({
    ...it,
    subtotal: r2(it.quantity * it.unitCost),
  }));
  const subtotal = r2(items.reduce((s, it) => s + it.subtotal, 0));
  const total = r2(subtotal - body.discount + body.tax);

  const id = await db.transaction(async (tx) => {
    const res = await tx.insert(purchases).values({
      code: generateCode(CODE_PREFIX.purchase),
      supplierId: body.supplierId,
      status: "ordered",
      orderDate: body.orderDate,
      subtotal,
      discount: body.discount,
      tax: body.tax,
      total,
      note: body.note || null,
      userId: user.id,
    });
    const purchaseId = insertIdOf(res);
    await tx.insert(purchaseItems).values(
      items.map((it) => ({
        purchaseId,
        productId: it.productId,
        batchNumber: it.batchNumber || null,
        expiryDate: it.expiryDate || null,
        quantity: it.quantity,
        unitCost: it.unitCost,
        subtotal: it.subtotal,
      })),
    );
    return purchaseId;
  });

  return c.json({ data: { id } }, 201);
});

/** Terima barang: buat batch baru + mutasi stok masuk. */
purchaseRoutes.post("/:id/receive", purchaseWrite, async (c) => {
  const id = parseId(c.req.param("id"));
  const body = await parse(c, purchaseReceiveInput);
  const user = c.get("user");

  await db.transaction(async (tx) => {
    const [po] = await tx
      .select()
      .from(purchases)
      .where(eq(purchases.id, id))
      .limit(1);
    if (!po) throw notFound();
    if (po.status === "received") throw conflict("Pembelian sudah diterima");
    if (po.status === "cancelled") throw conflict("Pembelian sudah dibatalkan");

    const items = await tx
      .select()
      .from(purchaseItems)
      .where(eq(purchaseItems.purchaseId, id));

    for (const it of items) {
      const res = await tx.insert(batches).values({
        productId: it.productId,
        supplierId: po.supplierId,
        batchNumber: it.batchNumber,
        expiryDate: it.expiryDate,
        quantity: it.quantity,
        costPrice: it.unitCost,
      });
      await tx.insert(stockMovements).values({
        productId: it.productId,
        batchId: insertIdOf(res),
        type: "purchase_in",
        quantity: it.quantity,
        costPrice: it.unitCost,
        refType: "purchase",
        refId: id,
        userId: user.id,
      });
      await tx
        .update(products)
        .set({ costPrice: it.unitCost })
        .where(eq(products.id, it.productId));
    }

    await tx
      .update(purchases)
      .set({ status: "received", receivedDate: body.receivedDate ?? localDate() })
      .where(eq(purchases.id, id));
  });

  return c.json({ success: true });
});

purchaseRoutes.post("/:id/cancel", purchaseWrite, async (c) => {
  const id = parseId(c.req.param("id"));
  const [po] = await db.select().from(purchases).where(eq(purchases.id, id)).limit(1);
  if (!po) throw notFound();
  if (po.status === "received") throw badRequest("Pembelian yang sudah diterima tidak bisa dibatalkan");
  await db.update(purchases).set({ status: "cancelled" }).where(eq(purchases.id, id));
  return c.json({ success: true });
});
