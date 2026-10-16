import type { Context } from "hono";
import { ZodError, type ZodTypeAny } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new HttpError(400, message, details);
export const unauthorized = (message = "Tidak terautentikasi") =>
  new HttpError(401, message);
export const forbidden = (message = "Tidak punya akses") =>
  new HttpError(403, message);
export const notFound = (message = "Data tidak ditemukan") =>
  new HttpError(404, message);
export const conflict = (message: string) => new HttpError(409, message);

/** Validasi input; melempar HttpError 422 berisi detail field. */
export async function parse<T extends ZodTypeAny>(
  c: Context,
  schema: T,
): Promise<ReturnType<T["parse"]>> {
  const body = await c.req.json().catch(() => ({}));
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new HttpError(
      422,
      "Validasi gagal",
      result.error.flatten().fieldErrors,
    );
  }
  return result.data;
}

/** Normalisasi insertId dari hasil insert (mysql2 bisa berupa array atau objek). */
export function insertIdOf(res: unknown): number {
  if (Array.isArray(res)) return (res[0] as { insertId: number }).insertId;
  return (res as { insertId: number }).insertId;
}

/** Jumlah baris yang terpengaruh oleh UPDATE/DELETE. */
export function affectedRowsOf(res: unknown): number {
  if (Array.isArray(res)) {
    return Number((res[0] as { affectedRows?: number }).affectedRows ?? 0);
  }
  return Number((res as { affectedRows?: number }).affectedRows ?? 0);
}

export function errorHandler(err: Error, c: Context) {
  if (err instanceof HttpError) {
    const headers: Record<string, string> = {};
    const retryAfter = (err.details as { retryAfter?: number } | undefined)?.retryAfter;
    if (err.status === 429 && retryAfter) headers["Retry-After"] = String(retryAfter);
    return c.json(
      { error: err.message, details: err.details ?? null },
      err.status as 400,
      headers,
    );
  }
  if (err instanceof ZodError) {
    return c.json({ error: "Validasi gagal", details: err.flatten() }, 422);
  }
  console.error("[unhandled]", err);
  return c.json({ error: "Terjadi kesalahan pada server" }, 500);
}

/**
 * Ambil & validasi parameter id numerik dari path.
 * Tanpa ini, `Number("abc")` → NaN ikut terkirim ke SQL dan memicu error 500.
 */
export function parseId(value: string | undefined, label = "ID"): number {
  const id = Number(value);
  if (!value || !Number.isInteger(id) || id <= 0) {
    throw badRequest(`${label} tidak valid`);
  }
  return id;
}

/**
 * Jalankan operasi yang bisa gagal karena konflik konkurensi DB.
 * MySQL mengembalikan deadlock (1213), lock wait timeout (1205), atau
 * ER_CHECKREAD saat dua transaksi menyentuh baris batch yang sama.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (error instanceof HttpError || !isTransientDbError(error) || i === attempts - 1) {
        throw error;
      }
      await Bun.sleep(5 * (i + 1) + Math.floor(Math.random() * 10));
    }
  }
  throw lastError;
}

/** Error penanda konflik data bersamaan; aman untuk dicoba ulang. */
export function concurrencyError(
  message = "Data berubah bersamaan, ulangi transaksi",
): Error {
  return Object.assign(new Error(message), { code: "ER_CHECKREAD" });
}

export function isTransientDbError(error: unknown): boolean {
  const e = error as { code?: string; errno?: number; message?: string } | null;
  if (!e) return false;
  const codes = [
    "ER_CHECKREAD",
    "ER_LOCK_DEADLOCK",
    "ER_LOCK_WAIT_TIMEOUT",
    "ER_QUERY_INTERRUPTED",
    // Kode dokumen yang bentrok saat beban tinggi; operasi yang diulang
    // akan membuat kode baru sehingga aman untuk dicoba lagi.
    "ER_DUP_ENTRY",
    "ECONNRESET",
    "PROTOCOL_CONNECTION_LOST",
  ];
  if (e.code && codes.includes(e.code)) return true;
  if (e.errno === 1213 || e.errno === 1205) return true;
  const msg = e.message ?? "";
  return /Record has changed since last read|Deadlock found|Lock wait timeout/i.test(msg);
}
