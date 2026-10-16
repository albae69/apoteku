import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  inArray,
  like,
  or,
  type SQL,
} from "drizzle-orm";
import { Hono } from "hono";
import { pagination, productInput } from "@apoteku/shared";
import { db } from "../db";
import { batches, categories, manufacturers, products, productUnits } from "../db/schema";
import { conflict, insertIdOf, notFound, parse, parseId } from "../lib/http";
import { productStock } from "../lib/sql";
import { requireRole } from "../middleware/auth";

/** Total stok tersedia (semua batch) per produk. */
const stockExpr = productStock();

export const productRoutes = new Hono();

/** Perubahan katalog produk hanya untuk owner/admin/apoteker. */
const productWrite = requireRole("owner", "admin", "pharmacist");

productRoutes.get("/", async (c) => {
  const q = pagination.parse(c.req.query());
  const categoryId = c.req.query("categoryId");
  const conds: SQL[] = [];
  if (q.q) {
    const c2 = or(
      like(products.name, `%${q.q}%`),
      like(products.genericName, `%${q.q}%`),
      like(products.sku, `%${q.q}%`),
      like(products.barcode, `%${q.q}%`),
    );
    if (c2) conds.push(c2);
  }
  if (categoryId) conds.push(eq(products.categoryId, Number(categoryId)));
  const where = conds.length ? and(...conds) : undefined;

  const rows = await db
    .select({
      ...getTableColumns(products),
      stock: stockExpr,
      categoryName: categories.name,
      manufacturerName: manufacturers.name,
    })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .leftJoin(manufacturers, eq(products.manufacturerId, manufacturers.id))
    .where(where)
    .orderBy(asc(products.name))
    .limit(q.perPage)
    .offset((q.page - 1) * q.perPage);

  const totalRow = await db.select({ value: count() }).from(products).where(where);
  const total = Number(totalRow[0]?.value ?? 0);

  return c.json({
    data: rows,
    meta: {
      page: q.page,
      perPage: q.perPage,
      total,
      totalPages: Math.max(1, Math.ceil(total / q.perPage)),
    },
  });
});

/** Pencarian untuk kasir: nama / barcode / sku, termasuk satuan & stok. */
productRoutes.get("/lookup", async (c) => {
  const term = (c.req.query("q") ?? "").trim();
  if (term.length < 1) return c.json({ data: [] });
  const conds = or(
    like(products.name, `%${term}%`),
    like(products.barcode, `%${term}%`),
    like(products.sku, `%${term}%`),
  );
  const rows = await db
    .select({
      ...getTableColumns(products),
      stock: stockExpr,
    })
    .from(products)
    .where(and(eq(products.isActive, true), conds))
    .orderBy(asc(products.name))
    .limit(20);

  const units =
    rows.length > 0
      ? await db
          .select()
          .from(productUnits)
          .where(
            inArray(
              productUnits.productId,
              rows.map((r) => r.id),
            ),
          )
      : [];

  return c.json({
    data: rows.map((p) => ({
      ...p,
      units: units.filter((u) => u.productId === p.id),
    })),
  });
});

productRoutes.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const [product] = await db
    .select({
      ...getTableColumns(products),
      stock: stockExpr,
    })
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  if (!product) throw notFound();
  const units = await db
    .select()
    .from(productUnits)
    .where(eq(productUnits.productId, id))
    .orderBy(asc(productUnits.conversion));
  const productBatches = await db
    .select()
    .from(batches)
    .where(eq(batches.productId, id))
    .orderBy(asc(batches.expiryDate));
  return c.json({ data: { ...product, units, batches: productBatches } });
});

productRoutes.post("/", productWrite, async (c) => {
  const body = await parse(c, productInput);
  const existing = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.sku, body.sku))
    .limit(1);
  if (existing.length) throw conflict("SKU sudah dipakai");

  const id = await db.transaction(async (tx) => {
    const { units, ...productData } = body;
    const res = await tx.insert(products).values({
      ...productData,
      barcode: productData.barcode || null,
      genericName: productData.genericName || null,
      strength: productData.strength || null,
      description: productData.description || null,
    });
    const productId = insertIdOf(res);
    if (units.length) {
      await tx.insert(productUnits).values(
        units.map((u) => ({
          productId,
          name: u.name,
          conversion: u.conversion,
          price: u.price ?? null,
          barcode: u.barcode || null,
          isBase: u.isBase,
        })),
      );
    }
    return productId;
  });

  return c.json({ data: { id } }, 201);
});

productRoutes.put("/:id", productWrite, async (c) => {
  const id = parseId(c.req.param("id"));
  const body = await parse(c, productInput);
  await db.transaction(async (tx) => {
    const { units, ...productData } = body;
    await tx
      .update(products)
      .set({
        ...productData,
        barcode: productData.barcode || null,
        genericName: productData.genericName || null,
        strength: productData.strength || null,
        description: productData.description || null,
      })
      .where(eq(products.id, id));
    await tx.delete(productUnits).where(eq(productUnits.productId, id));
    if (units.length) {
      await tx.insert(productUnits).values(
        units.map((u) => ({
          productId: id,
          name: u.name,
          conversion: u.conversion,
          price: u.price ?? null,
          barcode: u.barcode || null,
          isBase: u.isBase,
        })),
      );
    }
  });
  return c.json({ data: { id } });
});

productRoutes.delete("/:id", productWrite, async (c) => {
  const id = parseId(c.req.param("id"));
  try {
    await db.delete(products).where(eq(products.id, id));
  } catch {
    throw conflict("Produk tidak bisa dihapus karena sudah dipakai pada transaksi");
  }
  return c.json({ success: true });
});
