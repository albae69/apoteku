import type { Context, Next } from "hono";
import { env } from "../env";
import { writeAudit, type AuditActor } from "../lib/audit";
import { clientIp } from "./rate-limit";

/**
 * Detail audit yang bisa ditambahkan handler lewat `setAudit()`.
 * Middleware mengisi bagian umum (metode, path, status, aktor, IP) dan
 * menggabungkannya dengan detail spesifik dari handler.
 */
export type AuditOverride = {
  action?: string;
  event?: "http" | "auth" | "system";
  entity?: string | null;
  entityId?: number | string | null;
  detail?: Record<string, unknown> | null;
  actor?: AuditActor | null;
  outcome?: "success" | "failure";
  /** true = jangan catat permintaan ini. */
  skip?: boolean;
};

declare module "hono" {
  interface ContextVariableMap {
    audit: AuditOverride;
  }
}

/** Tambahkan/perkaya catatan audit untuk permintaan yang sedang berjalan. */
export function setAudit(c: Context, override: AuditOverride): void {
  c.set("audit", { ...(c.get("audit") ?? {}), ...override });
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SKIP_PATHS = new Set(["/health"]);
const SENSITIVE_KEY = /pass(wor)?d|token|secret|authorization|otp|pin|cvv/i;

/** Buang nilai sensitif & batasi panjang, agar file audit aman dibaca orang lain. */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[…]";
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redact(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : redact(val, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
  return value;
}

/** Aksi default bila handler tidak menentukannya, mis. `products.create`. */
function defaultAction(method: string, path: string): string {
  const resource = path.replace(/^\/api\/?/, "").split("/")[0] || "root";
  const verb =
    method === "POST"
      ? "create"
      : method === "PUT" || method === "PATCH"
        ? "update"
        : method === "DELETE"
          ? "delete"
          : "read";
  return `${resource}.${verb}`;
}

/**
 * Catat setiap permintaan yang mengubah data, ditambah kejadian autentikasi
 * dan apa pun yang menandai dirinya lewat `setAudit()`.
 * Baca (GET) hanya dicatat bila `AUDIT_LOG_READS=true`.
 */
export async function audit(c: Context, next: Next): Promise<void> {
  const startedAt = performance.now();
  try {
    await next();
  } catch (error) {
    record(c, startedAt, statusOf(error), "failure");
    throw error;
  }
  record(c, startedAt, c.res.status, "success");
}

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : 500;
}

function record(
  c: Context,
  startedAt: number,
  status: number,
  fallbackOutcome: "success" | "failure",
): void {
  if (!env.auditEnabled) return;

  const override = c.get("audit") ?? {};
  if (override.skip) return;

  const method = c.req.method;
  const path = c.req.path;
  if (SKIP_PATHS.has(path) || method === "OPTIONS") return;

  const isMutating = MUTATING.has(method);
  if (!isMutating && !override.action && !env.auditLogReads) return;

  const user = c.get("user");
  const actor: AuditActor | null =
    override.actor !== undefined
      ? override.actor
      : user
        ? { id: user.id, name: user.name, email: user.email, role: user.role }
        : null;

  writeAudit({
    event: override.event ?? "http",
    action: override.action ?? defaultAction(method, path),
    outcome:
      override.outcome ??
      (fallbackOutcome === "failure" ? "failure" : status >= 400 ? "failure" : "success"),
    method,
    path,
    status,
    durationMs: Math.round((performance.now() - startedAt) * 100) / 100,
    actor,
    ip: clientIp(c),
    userAgent: c.req.header("user-agent")?.slice(0, 200) ?? null,
    entity: override.entity ?? null,
    entityId: override.entityId ?? null,
    detail: override.detail ? (redact(override.detail) as Record<string, unknown>) : null,
  });
}
