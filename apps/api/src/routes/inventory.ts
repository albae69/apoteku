import { and, asc, desc, eq, getTableColumns, like, lte, or, sql, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { adjustmentInput, pagination } from "@apoteku/shared";
import { db } from "../db";
import { batches, products, stockMovements, users } from "../db/schema";
import { addDays, localDate } from "../lib/code";
import { badRequest, notFound, parse } from "../lib/http";
import { productStock } from "../lib/sql";
import { setAudit } from "../middleware/audit";
import { requireRole } from "../middleware/auth";

export const inventoryRoutes = new Hono();

/** Penyesuaian stok (opname, rusak, expired) hanya untuk owner/admin/apoteker. */
const stockWrite = requireRole("owner", "admin", "pharmacist");

/** Daftar batch + nama produk. Filter: q, productId, status (all|available|empty|expiring|expired). */
inventoryRoutes.get("/batches", async (c) => {
  const q = pagination.parse(c.req.query());
  const productId = c.req.query("productId");
  const status = c.req.query("status") ?? "all";
  const horizon = localDate(addDays(new Date(), 90));

  const conds: SQL[] = [];
  if (q.q) {
    const c2 = or(
      like(products.name, `%${q.q}%`),
      like(batches.batchNumber, `%${q.q}%`),
    );
    if (c2) conds.push(c2);
  }
  if (productId) conds.push(eq(batches.productId, Number(productId)));
  if (status === "available") conds.push(sql`${batches.quantity} > 0`);
  if (status === "empty") conds.push(sql`${batches.quantity} <= 0`);
  if (status === "expiring") {
    conds.push(sql`${batches.quantity} > 0 and ${batches.expiryDate} is not null and ${batches.expiryDate} <= ${horizon} and ${batches.expiryDate} >= ${localDate()}`);
  }
  if (status === "expired") {
    conds.push(sql`${batches.expiryDate} is not null and ${batches.expiryDate} < ${localDate()}`);
  }
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      ...getTableColumns(batches),
      productName: products.name,
      sku: products.sku,
      baseUnit: products.baseUnit,
    })
    .from(batches)
    .innerJoin(products, eq(batches.productId, products.id))
    .where(where)
    .orderBy(asc(batches.expiryDate), asc(batches.id))
    .limit(q.perPage)
    .offset((q.page - 1) * q.perPage);

  return c.json({ data: rows });
});

/** Stok per produk (agregat batch). */
inventoryRoutes.get("/stock", async (c) => {
  const q = pagination.parse(c.req.query());
  const onlyLow = c.req.query("low") === "true";
  const stockExpr = productStock();

  const conds: SQL[] = [eq(products.isActive, true)];
  if (q.q) {
    const c2 = or(like(products.name, `%${q.q}%`), like(products.sku, `%${q.q}%`));
    if (c2) conds.push(c2);
  }
  if (onlyLow) conds.push(sql`${stockExpr} <= ${products.minStock}`);

  const rows = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      baseUnit: products.baseUnit,
      minStock: products.minStock,
      salePrice: products.salePrice,
      costPrice: products.costPrice,
      stock: stockExpr,
    })
    .from(products)
    .where(and(...conds))
    .orderBy(asc(products.name))
    .limit(q.perPage)
    .offset((q.page - 1) * q.perPage);

  return c.json({ data: rows });
});

/** Kartu stok / mutasi. */
inventoryRoutes.get("/movements", async (c) => {
  const q = pagination.parse(c.req.query());
  const productId = c.req.query("productId");
  const conds: SQL[] = [];
  if (productId) conds.push(eq(stockMovements.productId, Number(productId)));
  if (q.q) {
    const c2 = or(
      like(products.name, `%${q.q}%`),
      like(stockMovements.note, `%${q.q}%`),
    );
    if (c2) conds.push(c2);
  }
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      ...getTableColumns(stockMovements),
      productName: products.name,
      userName: users.name,
      batchNumber: batches.batchNumber,
    })
    .from(stockMovements)
    .innerJoin(products, eq(stockMovements.productId, products.id))
    .leftJoin(users, eq(stockMovements.userId, users.id))
    .leftJoin(batches, eq(stockMovements.batchId, batches.id))
    .where(where)
    .orderBy(desc(stockMovements.createdAt))
    .limit(q.perPage)
    .offset((q.page - 1) * q.perPage);

  return c.json({ data: rows });
});

/** Peringatan: stok rendah + mendekati/melewati kedaluwarsa. */
inventoryRoutes.get("/alerts", async (c) => {
  const horizon = localDate(addDays(new Date(), 90));
  const stockExpr = productStock();

  const lowStock = await db
    .select({
      id: products.id,
      name: products.name,
      sku: products.sku,
      baseUnit: products.baseUnit,
      minStock: products.minStock,
      stock: stockExpr,
    })
    .from(products)
    .where(and(eq(products.isActive, true), sql`${stockExpr} <= ${products.minStock}`))
    .orderBy(asc(products.name))
    .limit(50);

  const expiring = await db
    .select({
      id: batches.id,
      productId: batches.productId,
      productName: products.name,
      batchNumber: batches.batchNumber,
      expiryDate: batches.expiryDate,
      quantity: batches.quantity,
      baseUnit: products.baseUnit,
    })
    .from(batches)
    .innerJoin(products, eq(batches.productId, products.id))
    .where(
      and(
        sql`${batches.quantity} > 0`,
        sql`${batches.expiryDate} is not null`,
        lte(batches.expiryDate, horizon),
      ),
    )
    .orderBy(asc(batches.expiryDate))
    .limit(50);

  return c.json({ data: { lowStock, expiring } });
});

/** Penyesuaian stok manual (rusak, expired, opname, dsb). */
inventoryRoutes.post("/adjust", stockWrite, async (c) => {
  const body = await parse(c, adjustmentInput);
  const user = c.get("user");

  await db.transaction(async (tx) => {
    const [batch] = await tx
      .select()
      .from(batches)
      .where(eq(batches.id, body.batchId))
      .limit(1);
    if (!batch) throw notFound("Batch tidak ditemukan");
    const next = batch.quantity + body.quantity;
    if (next < 0) throw badRequest("Stok tidak boleh menjadi negatif");

    await tx.update(batches).set({ quantity: next }).where(eq(batches.id, batch.id));
    await tx.insert(stockMovements).values({
      productId: batch.productId,
      batchId: batch.id,
      type: body.type,
      quantity: body.quantity,
      costPrice: batch.costPrice,
      refType: "adjustment",
      note: body.note || null,
      userId: user.id,
    });
  });

  setAudit(c, {
    action: "inventory.adjust",
    entity: "batch",
    entityId: body.batchId,
    detail: {
      type: body.type,
      quantityDelta: body.quantity,
      note: body.note || null,
    },
  });

  return c.json({ success: true });
});
