/**
 * Audit log harian berbasis file (append-only, satu file per hari).
 *
 * Format: teks berformat JSON Lines (satu kejadian per baris) di
 * `<AUDIT_DIR>/audit-YYYY-MM-DD.log`. Dipisah per hari agar mudah
 * diarsipkan/dihapus, dan tulisannya langsung di-flush supaya isi log
 * tidak hilang bila proses berhenti mendadak.
 */
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { env } from "../env";
import { localDate } from "./code";

export type AuditActor = {
  id: number;
  name: string;
  email: string;
  role: string;
};

export type AuditRecord = {
  /** Waktu ISO 8601 (UTC). */
  ts: string;
  event: "http" | "auth" | "system";
  /** Mis. `sale.create`, `shift.close`, `auth.login`. */
  action: string;
  outcome: "success" | "failure";
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  actor: AuditActor | null;
  ip?: string;
  userAgent?: string | null;
  entity?: string | null;
  entityId?: number | string | null;
  detail?: Record<string, unknown> | null;
};

export type AuditQuery = {
  limit?: number;
  action?: string;
  event?: string;
  outcome?: string;
  userId?: number;
};

const FILE_RE = /^audit-\d{4}-\d{2}-\d{2}\.log$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const auditFilePath = (date: string) => join(env.auditDir, `audit-${date}.log`);

if (env.auditEnabled) {
  mkdirSync(env.auditDir, { recursive: true });
}

let sink: Bun.FileSink | null = null;
let sinkDate = "";

/** Sink untuk tanggal tertentu; berganti otomatis saat hari berubah. */
function getSink(date: string): Bun.FileSink {
  if (sink && sinkDate === date) return sink;
  closeSink();
  sink = Bun.file(auditFilePath(date)).writer();
  sinkDate = date;
  pruneOldFiles();
  return sink;
}

function closeSink() {
  if (!sink) return;
  try {
    sink.end();
  } catch {
    /* abaikan: hanya penutupan buffer */
  }
  sink = null;
  sinkDate = "";
}

/** Tulis satu kejadian audit. Tidak pernah melempar error ke pemanggil. */
export function writeAudit(record: Omit<AuditRecord, "ts"> & { ts?: string }): void {
  if (!env.auditEnabled) return;
  try {
    const now = new Date();
    const entry: AuditRecord = { ts: now.toISOString(), ...record };
    const target = getSink(localDate(now));
    target.write(`${JSON.stringify(entry)}\n`);
    // Flush segera: volume audit rendah, dan isi log harus tahan proses mati.
    target.flush();
  } catch (error) {
    console.error("[audit] gagal menulis log", error);
  }
}

/** Tutup file audit yang sedang terbuka (dipakai sebelum proses berhenti). */
export function closeAudit(): void {
  closeSink();
}

/** Hapus berkas audit yang lebih tua dari `AUDIT_RETENTION_DAYS`. */
export function pruneOldFiles(): number {
  if (!env.auditEnabled || env.auditRetentionDays <= 0) return 0;
  const cutoff = Date.now() - env.auditRetentionDays * 86_400_000;
  let removed = 0;
  try {
    for (const name of readdirSync(env.auditDir)) {
      if (!FILE_RE.test(name)) continue;
      const path = join(env.auditDir, name);
      try {
        if (statSync(path).mtimeMs < cutoff) {
          unlinkSync(path);
          removed++;
        }
      } catch {
        /* lewati berkas yang tidak bisa dibaca/dihapus */
      }
    }
  } catch {
    /* direktori belum ada */
  }
  return removed;
}

/** Daftar tanggal yang punya berkas audit, terbaru lebih dulu. */
export function listAuditDays(): { date: string; size: number }[] {
  try {
    return readdirSync(env.auditDir)
      .filter((name) => FILE_RE.test(name))
      .map((name) => ({
        date: name.slice(6, 16),
        size: statSync(join(env.auditDir, name)).size,
      }))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  } catch {
    return [];
  }
}

/**
 * Baca kejadian audit pada tanggal tertentu (terbaru lebih dulu di file,
 * hasil dikembalikan urut lama → baru).
 */
export async function readAudit(
  date: string,
  query: AuditQuery = {},
): Promise<AuditRecord[]> {
  if (!DATE_RE.test(date)) throw new Error("Format tanggal harus YYYY-MM-DD");
  let text: string;
  try {
    text = await readFile(auditFilePath(date), "utf8");
  } catch {
    return [];
  }

  const limit = Math.min(Math.max(query.limit ?? 200, 1), 2000);
  const lines = text.split("\n");
  const out: AuditRecord[] = [];

  // Mulai dari baris terakhir supaya `limit` berarti "N kejadian terakhir".
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    const line = lines[i]?.trim();
    if (!line) continue;
    let record: AuditRecord;
    try {
      record = JSON.parse(line) as AuditRecord;
    } catch {
      continue; // baris rusak (mis. proses mati saat menulis) — lewati
    }
    if (query.action && record.action !== query.action) continue;
    if (query.event && record.event !== query.event) continue;
    if (query.outcome && record.outcome !== query.outcome) continue;
    if (query.userId && record.actor?.id !== query.userId) continue;
    out.push(record);
  }
  return out.reverse();
}
