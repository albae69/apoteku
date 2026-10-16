export const CODE_PREFIX = {
  purchase: "PO",
  sale: "INV",
  prescription: "RSP",
} as const;

/** Sufiks acak base36 dengan panjang tetap (uniform, bukan `Math.random`). */
function randomSuffix(len: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

/**
 * Buat kode human-readable: PREFIX-YYYYMMDD-XXXXXX.
 * Sufiks 6 karakter (36^6 ≈ 2,2 miliar) agar praktis tidak bentrok
 * walau ribuan transaksi dibuat dalam satu hari.
 */
export function generateCode(prefix: string): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(
    d.getDate(),
  ).padStart(2, "0")}`;
  return `${prefix}-${ymd}-${randomSuffix(6)}`;
}

/** Tanggal lokal (YYYY-MM-DD) — aman untuk MySQL DATE. */
export function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}
