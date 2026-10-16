import { and, desc, eq, getTableColumns, ne, sql } from "drizzle-orm";
import { Hono } from "hono";
import { closeShiftInput, openShiftInput } from "@apoteku/shared";
import { db } from "../db";
import { payments, sales, shifts, users } from "../db/schema";
import { conflict, forbidden, insertIdOf, notFound, parse, parseId } from "../lib/http";
import { setAudit } from "../middleware/audit";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const shiftRoutes = new Hono();

/** Rekap penjualan & uang tunai untuk sebuah shift. */
async function shiftTotals(shiftId: number) {
  const [salesRow] = await db
    .select({
      transactionCount: sql<number>`count(*)`.mapWith(Number),
      totalSales: sql<number>`coalesce(sum(${sales.total}), 0)`.mapWith(Number),
    })
    .from(sales)
    .where(and(eq(sales.shiftId, shiftId), eq(sales.status, "completed")));

  const [nonCashRow] = await db
    .select({
      totalNonCash: sql<number>`coalesce(sum(${payments.amount}), 0)`.mapWith(Number),
    })
    .from(payments)
    .innerJoin(sales, eq(payments.saleId, sales.id))
    .where(
      and(
        eq(sales.shiftId, shiftId),
        eq(sales.status, "completed"),
        ne(payments.method, "cash"),
      ),
    );

  const totalSales = r2(Number(salesRow?.totalSales ?? 0));
  const totalNonCash = r2(Number(nonCashRow?.totalNonCash ?? 0));
  // Tunai = total penjualan - pembayaran non-tunai (kembalian tidak dihitung sebagai kas masuk).
  const totalCash = r2(Math.max(0, totalSales - totalNonCash));

  return {
    transactionCount: Number(salesRow?.transactionCount ?? 0),
    totalSales,
    totalCash,
    totalNonCash,
  };
}

/** Shift yang sedang terbuka untuk user yang login (null bila belum buka). */
shiftRoutes.get("/current", async (c) => {
  const user = c.get("user");
  const [shift] = await db
    .select()
    .from(shifts)
    .where(and(eq(shifts.userId, user.id), eq(shifts.status, "open")))
    .orderBy(desc(shifts.openedAt))
    .limit(1);
  if (!shift) return c.json({ data: null });

  const totals = await shiftTotals(shift.id);
  return c.json({
    data: {
      ...shift,
      ...totals,
      expectedCash: r2(shift.openingCash + totals.totalCash),
    },
  });
});

shiftRoutes.post("/open", async (c) => {
  const user = c.get("user");
  const body = await parse(c, openShiftInput);

  const [existing] = await db
    .select({ id: shifts.id })
    .from(shifts)
    .where(and(eq(shifts.userId, user.id), eq(shifts.status, "open")))
    .limit(1);
  if (existing) throw conflict("Masih ada shift yang terbuka. Tutup dulu sebelum buka shift baru.");

  const res = await db.insert(shifts).values({
    userId: user.id,
    status: "open",
    openingCash: body.openingCash,
    note: body.note || null,
  });
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, insertIdOf(res)))
    .limit(1);

  setAudit(c, {
    action: "shift.open",
    entity: "shift",
    entityId: shift?.id ?? null,
    detail: { openingCash: body.openingCash, note: body.note || null },
  });

  return c.json({ data: shift }, 201);
});

shiftRoutes.post("/:id/close", async (c) => {
  const id = parseId(c.req.param("id"));
  const user = c.get("user");
  const body = await parse(c, closeShiftInput);

  const [shift] = await db.select().from(shifts).where(eq(shifts.id, id)).limit(1);
  if (!shift) throw notFound("Shift tidak ditemukan");
  if (shift.status === "closed") throw conflict("Shift sudah ditutup");
  // Hanya pemilik shift (atau owner) yang boleh menutupnya.
  if (shift.userId !== user.id && user.role !== "owner") {
    throw forbidden("Hanya pemilik shift yang boleh menutup shift ini");
  }

  const totals = await shiftTotals(id);
  const expectedCash = r2(shift.openingCash + totals.totalCash);

  await db
    .update(shifts)
    .set({
      status: "closed",
      closedAt: new Date(),
      closingCash: body.closingCash,
      expectedCash,
      difference: r2(body.closingCash - expectedCash),
      totalSales: totals.totalSales,
      totalCash: totals.totalCash,
      totalNonCash: totals.totalNonCash,
      transactionCount: totals.transactionCount,
      note: body.note || shift.note || null,
    })
    .where(eq(shifts.id, id));

  const [updated] = await db.select().from(shifts).where(eq(shifts.id, id)).limit(1);

  setAudit(c, {
    action: "shift.close",
    entity: "shift",
    entityId: id,
    detail: {
      closingCash: body.closingCash,
      expectedCash,
      difference: r2(body.closingCash - expectedCash),
      transactionCount: totals.transactionCount,
      totalSales: totals.totalSales,
      totalCash: totals.totalCash,
      totalNonCash: totals.totalNonCash,
    },
  });

  return c.json({ data: updated });
});

shiftRoutes.get("/", async (c) => {
  const rows = await db
    .select({
      ...getTableColumns(shifts),
      userName: users.name,
    })
    .from(shifts)
    .leftJoin(users, eq(shifts.userId, users.id))
    .orderBy(desc(shifts.openedAt))
    .limit(100);

  // Lengkapi shift yang masih terbuka dengan rekap berjalan.
  const enriched = await Promise.all(
    rows.map(async (s) => {
      if (s.status === "closed") return s;
      const totals = await shiftTotals(s.id);
      return {
        ...s,
        ...totals,
        expectedCash: r2(s.openingCash + totals.totalCash),
      };
    }),
  );

  return c.json({ data: enriched });
});

shiftRoutes.get("/:id", async (c) => {
  const id = parseId(c.req.param("id"));
  const [shift] = await db
    .select({ ...getTableColumns(shifts), userName: users.name })
    .from(shifts)
    .leftJoin(users, eq(shifts.userId, users.id))
    .where(eq(shifts.id, id))
    .limit(1);
  if (!shift) throw notFound("Shift tidak ditemukan");

  const shiftSales = await db
    .select({
      id: sales.id,
      code: sales.code,
      total: sales.total,
      status: sales.status,
      createdAt: sales.createdAt,
    })
    .from(sales)
    .where(eq(sales.shiftId, id))
    .orderBy(desc(sales.createdAt));

  return c.json({ data: { ...shift, sales: shiftSales } });
});
