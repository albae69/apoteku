import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { Hono } from "hono";
import { db } from "../db";
import { batches, products, saleItems, sales } from "../db/schema";
import { addDays, localDate, startOfToday } from "../lib/code";
import { inventoryValue, productStock } from "../lib/sql";

export const dashboardRoutes = new Hono();

dashboardRoutes.get("/summary", async (c) => {
  const [today] = await db
    .select({
      transactions: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(${sales.total}), 0)`,
      profit: sql<number>`coalesce(sum(${sales.total} - ${sales.costTotal}), 0)`,
    })
    .from(sales)
    .where(and(eq(sales.status, "completed"), gte(sales.createdAt, startOfToday())));

  const [inventory] = await db
    .select({ products: sql<number>`count(*)`.mapWith(Number) })
    .from(products)
    .where(eq(products.isActive, true));

  const stockExpr = productStock();

  const [lowStock] = await db
    .select({ value: sql<number>`count(*)` })
    .from(products)
    .where(and(eq(products.isActive, true), sql`${stockExpr} <= ${products.minStock}`));

  const horizon = localDate(addDays(new Date(), 90));
  const [expiring] = await db
    .select({ value: sql<number>`count(*)` })
    .from(batches)
    .where(
      and(
        sql`${batches.quantity} > 0`,
        sql`${batches.expiryDate} is not null`,
        lte(batches.expiryDate, horizon),
      ),
    );

  const topProducts = await db
    .select({
      productId: saleItems.productId,
      name: products.name,
      quantity: sql<number>`sum(${saleItems.quantity})`,
      revenue: sql<number>`sum(${saleItems.subtotal})`,
    })
    .from(saleItems)
    .innerJoin(sales, eq(saleItems.saleId, sales.id))
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(and(eq(sales.status, "completed"), gte(sales.createdAt, startOfToday())))
    .groupBy(saleItems.productId, products.name)
    .orderBy(desc(sql`sum(${saleItems.subtotal})`))
    .limit(5);

  const recentSales = await db
    .select({
      id: sales.id,
      code: sales.code,
      total: sales.total,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .orderBy(desc(sales.createdAt))
    .limit(5);

  // Nilai persediaan berdasarkan batch tersisa.
  const [stockValue] = await db
    .select({ value: inventoryValue() })
    .from(batches)
    .limit(1);

  return c.json({
    data: {
      today: {
        transactions: Number(today?.transactions ?? 0),
        revenue: Number(today?.revenue ?? 0),
        profit: Number(today?.profit ?? 0),
      },
      counts: {
        products: Number(inventory?.products ?? 0),
        lowStock: Number(lowStock?.value ?? 0),
        expiring: Number(expiring?.value ?? 0),
      },
      stockValue: Number(stockValue?.value ?? 0),
      topProducts,
      recentSales,
    },
  });
});
