import { and, count, desc, eq, like, or, type SQL } from "drizzle-orm";
import type { MySqlTable } from "drizzle-orm/mysql-core";
import { Hono, type MiddlewareHandler } from "hono";
import type { ZodTypeAny } from "zod";
import { pagination, type UserRole } from "@apoteku/shared";
import { db } from "../db";
import { requireRole } from "../middleware/auth";
import { HttpError, insertIdOf, notFound, parse, parseId } from "./http";

type CrudConfig = {
  table: MySqlTable;
  createSchema: ZodTypeAny;
  updateSchema?: ZodTypeAny;
  searchColumns?: string[];
  orderBy?: string;
  /** Role yang boleh membuat/mengubah/menghapus. Kosong = semua role. */
  writeRoles?: UserRole[];
};

/** Router CRUD generik untuk master data sederhana. */
export function crudRoutes(cfg: CrudConfig) {
  const router = new Hono();
  const t = cfg.table as unknown as Record<string, never>;
  const table = cfg.table as never;
  const idCol = () => (t as unknown as { id: never }).id;
  const writeGuard: MiddlewareHandler[] = cfg.writeRoles?.length
    ? [requireRole(...cfg.writeRoles)]
    : [];

  // Terapkan guard role hanya untuk metode yang mengubah data.
  if (writeGuard.length) {
    router.use("*", async (c, next) => {
      if (c.req.method === "GET" || c.req.method === "HEAD") return next();
      return writeGuard[0]!(c, next);
    });
  }

  router.get("/", async (c) => {
    const q = pagination.parse(c.req.query());
    const conditions: SQL[] = [];
    if (q.q && cfg.searchColumns?.length) {
      const parts = cfg.searchColumns.map((col) =>
        like((t as Record<string, never>)[col] as never, `%${q.q}%`),
      );
      const combined = or(...parts);
      if (combined) conditions.push(combined);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const rows = await db
      .select()
      .from(table)
      .where(where)
      .orderBy(desc((t as Record<string, never>)[cfg.orderBy ?? "createdAt"] as never))
      .limit(q.perPage)
      .offset((q.page - 1) * q.perPage);
    const totalRow = (await db
      .select({ value: count() })
      .from(table)
      .where(where)) as { value: number }[];
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

  router.get("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const [row] = await db.select().from(table).where(eq(idCol(), id as never)).limit(1);
    if (!row) throw notFound();
    return c.json({ data: row });
  });

  router.post("/", async (c) => {
    const body = await parse(c, cfg.createSchema);
    const res = await db.insert(table).values(body as never);
    const [row] = await db
      .select()
      .from(table)
      .where(eq(idCol(), insertIdOf(res) as never))
      .limit(1);
    return c.json({ data: row }, 201);
  });

  router.put("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const schema = cfg.updateSchema ?? cfg.createSchema;
    const body = await parse(c, schema);
    const res = await db.update(table).set(body as never).where(eq(idCol(), id as never));
    if (Number((res as unknown as { affectedRows?: number }).affectedRows ?? 1) === 0) {
      throw notFound();
    }
    const [row] = await db.select().from(table).where(eq(idCol(), id as never)).limit(1);
    return c.json({ data: row });
  });

  router.delete("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    try {
      await db.delete(table).where(eq(idCol(), id as never));
    } catch {
      throw new HttpError(409, "Data tidak bisa dihapus karena masih dipakai");
    }
    return c.json({ success: true });
  });

  return router;
}
