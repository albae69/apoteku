import { and, asc, desc, eq, getTableColumns, gt, gte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { saleInput } from "@apoteku/shared";
import { db } from "../db";
import {
  batches,
  customers,
  payments,
  products,
  productUnits,
  saleItems,
  sales,
  shifts,
  stockMovements,
  users,
} from "../db/schema";
import { CODE_PREFIX, generateCode, startOfToday } from "../lib/code";
import {
  affectedRowsOf,
  badRequest,
  concurrencyError,
  conflict,
  insertIdOf,
  isTransientDbError,
  notFound,
  parse,
  parseId,
  withRetry,
} from "../lib/http";
import { childCount } from "../lib/sql";
import { setAudit } from "../middleware/audit";

const r2 = (n: number) => Math.round(n * 100) / 100;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Alokasi FEFO: ambil dari batch yang paling cepat kedaluwarsa.
 * Mengurangi stok batch dan mengembalikan rincian alokasi.
 *
 * Pengurangan stok memakai pola bandingkan-dan-set (compare-and-set):
 * `UPDATE ... WHERE id = ? AND quantity >= take`. Kondisi `quantity >= take`
 * dievaluasi ulang terhadap versi baris terbaru sehingga dua transaksi
 * bersamaan tidak bisa menjual stok yang sama. Bila baris sudah berubah,
 * transaksi dilempar untuk dicoba ulang oleh `withRetry`.
 */
async function allocateFefo(tx: Tx, productId: number, needed: number) {
  const rows = await tx
    .select({
      id: batches.id,
      quantity: batches.quantity,
      costPrice: batches.costPrice,
    })
    .from(batches)
    .where(and(eq(batches.productId, productId), gt(batches.quantity, 0)))
    .orderBy(asc(batches.expiryDate), asc(batches.id));

  const allocations: {
    batchId: number;
    quantity: number;
    costPrice: number;
  }[] = [];
  let remaining = needed;

  for (const b of rows) {
    if (remaining <= 0) break;
    const take = r2(Math.min(b.quantity, remaining));
    if (take <= 0) continue;

    const res = await tx
      .update(batches)
      .set({ quantity: sql`${batches.quantity} - ${take}` })
      .where(and(eq(batches.id, b.id), gte(batches.quantity, take)));

    if (affectedRowsOf(res) === 0) {
      throw concurrencyError();
    }

    allocations.push({ batchId: b.id, quantity: take, costPrice: b.costPrice });
    remaining = r2(remaining - take);
  }

  if (remaining > 0) {
    throw conflict("Stok tidak mencukupi untuk salah satu produk");
  }
  return allocations;
}

export const saleRoutes = new Hono();

/** Shift yang sedang terbuka untuk user tertentu. */
async function getOpenShift(userId: number) {
  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.userId, userId), eq(shifts.status, "open")))
    .orderBy(desc(shifts.openedAt))
    .limit(1);
  return shift ?? null;
}

/** Detail nota lengkap (header + item + pembayaran) untuk struk/detail. */
async function getSaleDetail(id: number) {
  const [sale] = await db
    .select({
      ...getTableColumns(sales),
      customerName: customers.name,
      cashierName: users.name,
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(users, eq(sales.userId, users.id))
    .where(eq(sales.id, id))
    .limit(1);
  if (!sale) return null;

  const items = await db
    .select({
      ...getTableColumns(saleItems),
      productName: products.name,
      baseUnit: products.baseUnit,
      batchNumber: batches.batchNumber,
    })
    .from(saleItems)
    .innerJoin(products, eq(saleItems.productId, products.id))
    .leftJoin(batches, eq(saleItems.batchId, batches.id))
    .where(eq(saleItems.saleId, id));

  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.saleId, id));

  return { ...sale, items, payments: paymentRows };
}

saleRoutes.get("/", async (c) => {
  const from = c.req.query("from");
  const rows = await db
    .select({
      ...getTableColumns(sales),
      customerName: customers.name,
      userName: users.name,
      itemCount: childCount("sale_items", "sale_id", "sales"),
    })
    .from(sales)
    .leftJoin(customers, eq(sales.customerId, customers.id))
    .leftJoin(users, eq(sales.userId, users.id))
    .where(from ? gte(sales.createdAt, new Date(from)) : undefined)
    .orderBy(desc(sales.createdAt))
    .limit(200);
  return c.json({ data: rows });
});

saleRoutes.get("/:id", async (c) => {
  const detail = await getSaleDetail(parseId(c.req.param("id")));
  if (!detail) throw notFound();
  return c.json({ data: detail });
});

saleRoutes.post("/", async (c) => {
  const body = await parse(c, saleInput);
  const user = c.get("user");

  const openShift = await getOpenShift(user.id);
  if (!openShift) {
    throw conflict("Buka shift kasir terlebih dahulu sebelum bertransaksi");
  }

  const runSale = () =>
    db.transaction(async (tx) => {
    type LineSeed = typeof saleItems.$inferInsert & { saleId: number };
    const lines: Omit<LineSeed, "saleId">[] = [];
    const movementSeeds: {
      productId: number;
      batchId: number;
      quantity: number;
      costPrice: number;
    }[] = [];
    let subtotal = 0;
    let costTotal = 0;

    for (const item of body.items) {
      const [product] = await tx
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);
      if (!product) throw notFound(`Produk #${item.productId} tidak ditemukan`);
      if (!product.isActive) throw badRequest(`${product.name} sedang tidak aktif`);

      let baseQty = item.quantity;
      let conversion = 1;
      if (item.unitId) {
        const [unit] = await tx
          .select()
          .from(productUnits)
          .where(eq(productUnits.id, item.unitId))
          .limit(1);
        if (!unit) throw notFound("Satuan jual tidak ditemukan");
        conversion = unit.conversion;
        baseQty = r2(item.quantity * conversion);
      }

      // Harga disimpan per satuan dasar; item dijual bisa dalam satuan besar.
      const pricePerBase = r2(item.unitPrice / conversion);
      const allocations = await allocateFefo(tx, product.id, baseQty);
      let first = true;
      for (const a of allocations) {
        const lineDiscount = first ? item.discount : 0;
        const lineSubtotal = r2(a.quantity * pricePerBase - lineDiscount);
        subtotal = r2(subtotal + lineSubtotal);
        costTotal = r2(costTotal + a.quantity * a.costPrice);
        lines.push({
          productId: product.id,
          batchId: a.batchId,
          quantity: a.quantity,
          unitPrice: pricePerBase,
          costPrice: a.costPrice,
          discount: lineDiscount,
          subtotal: lineSubtotal,
        });
        movementSeeds.push({
          productId: product.id,
          batchId: a.batchId,
          quantity: -a.quantity,
          costPrice: a.costPrice,
        });
        first = false;
      }
    }

    // Diskon item sudah mengurangi `subtotal`; `body.discount` adalah diskon level nota.
    const total = r2(Math.max(0, subtotal - body.discount + body.tax));
    const paidAmount = r2(body.payments.reduce((s, p) => s + p.amount, 0));
    if (paidAmount + 0.001 < total) {
      throw badRequest("Jumlah pembayaran kurang dari total");
    }

    const saleRes = await tx.insert(sales).values({
      code: generateCode(CODE_PREFIX.sale),
      customerId: body.customerId ?? null,
      prescriptionId: body.prescriptionId ?? null,
      shiftId: openShift.id,
      status: "completed",
      subtotal,
      discount: body.discount,
      tax: body.tax,
      total,
      paidAmount,
      changeAmount: r2(paidAmount - total),
      costTotal,
      note: body.note || null,
      userId: user.id,
    });
    const saleId = insertIdOf(saleRes);

    await tx.insert(saleItems).values(lines.map((l) => ({ ...l, saleId })));
    await tx.insert(stockMovements).values(
      movementSeeds.map((m) => ({
        ...m,
        type: "sale_out" as const,
        refType: "sale",
        refId: saleId,
        userId: user.id,
      })),
    );
    await tx.insert(payments).values(
      body.payments.map((p) => ({
        saleId,
        method: p.method,
        amount: p.amount,
        reference: p.reference || null,
      })),
    );

    if (body.customerId) {
      const pts = Math.floor(total / 10000);
      if (pts > 0) {
        await tx
          .update(customers)
          .set({ points: sql`${customers.points} + ${pts}` })
          .where(eq(customers.id, body.customerId));
      }
    }

    return saleId;
  });

  // Retry otomatis bila ada konflik konkurensi (deadlock / baris berubah).
  let result: number;
  try {
    result = await withRetry(runSale, 6);
  } catch (error) {
    if (isTransientDbError(error)) {
      // Sudah dicoba beberapa kali namun stok terus berubah: minta kasir ulangi.
      throw conflict("Stok berubah karena transaksi lain. Silakan coba lagi.");
    }
    throw error;
  }

  const detail = await getSaleDetail(result);
  if (!detail) throw notFound("Transaksi tidak ditemukan setelah disimpan");

  setAudit(c, {
    action: "sale.create",
    entity: "sale",
    entityId: detail.id,
    detail: {
      code: detail.code,
      total: detail.total,
      itemCount: detail.items.length,
      paymentMethods: detail.payments.map((p) => p.method),
      shiftId: openShift.id,
      customerId: body.customerId ?? null,
    },
  });

  return c.json({ data: detail }, 201);
});

/** Ringkasan penjualan hari ini (untuk header kasir). */
saleRoutes.get("/summary/today", async (c) => {
  const [row] = await db
    .select({
      transactions: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(${sales.total}), 0)`,
      profit: sql<number>`coalesce(sum(${sales.total} - ${sales.costTotal}), 0)`,
    })
    .from(sales)
    .where(and(eq(sales.status, "completed"), gte(sales.createdAt, startOfToday())));
  return c.json({ data: row });
});
