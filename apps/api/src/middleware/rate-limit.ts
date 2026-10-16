import type { Context } from "hono";
import { HttpError } from "../lib/http";

type Bucket = { count: number; resetAt: number };

/**
 * Rate limiter in-memory (fixed window) untuk mencegah brute force.
 *
 * `take()` mencatat satu percobaan secara sinkron (tanpa `await`) sehingga
 * pemeriksaan kuota tetap deterministik walau ada banyak request bersamaan.
 * `refund()` dipakai saat percobaan ternyata berhasil (login sukses) agar
 * pemakaian normal tidak ikut membebani kuota.
 */
export function rateLimit(opts: {
  windowMs: number;
  max: number;
  message?: string;
}) {
  const buckets = new Map<string, Bucket>();
  const { windowMs, max } = opts;

  function prune(now: number) {
    if (buckets.size < 5000) return;
    for (const [key, b] of buckets) {
      if (b.resetAt <= now) buckets.delete(key);
    }
  }

  return {
    take(key: string) {
      const now = Date.now();
      prune(now);
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + windowMs };
        buckets.set(key, bucket);
      }
      if (bucket.count >= max) {
        throw new HttpError(
          429,
          opts.message ?? "Terlalu banyak percobaan. Coba lagi nanti.",
          { retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) },
        );
      }
      bucket.count++;
    },
    refund(key: string) {
      const bucket = buckets.get(key);
      if (bucket && bucket.count > 0) bucket.count--;
    },
    clear() {
      buckets.clear();
    },
  };
}

/** IP klien; hormati header proxy bila API berada di belakang reverse proxy. */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return c.req.header("x-real-ip") ?? "local";
}
