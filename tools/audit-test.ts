/**
 * Verifikasi audit log harian.
 * Jalankan: bun run tools/audit-test.ts
 *
 * Menguji bahwa kejadian penting benar-benar tertulis ke berkas harian,
 * berisi aktor/detail yang tepat, tidak membocorkan rahasia, dan hanya
 * bisa dibaca oleh owner/admin.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE ?? "http://localhost:4000";
const AUDIT_DIR = process.env.AUDIT_DIR ?? join(process.cwd(), "apps/api/logs/audit");

type AuditRecord = {
  ts: string;
  event: string;
  action: string;
  outcome: string;
  method?: string;
  path?: string;
  status?: number;
  actor: { id: number; name: string; email: string; role: string } | null;
  ip?: string;
  entity?: string | null;
  entityId?: number | string | null;
  detail?: Record<string, unknown> | null;
};

type Check = { code: string; name: string; pass: boolean; detail: string };
const checks: Check[] = [];
const add = (c: Check) => checks.push(c);

const jsonHeaders = { "Content-Type": "application/json" };

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* bukan JSON */
  }
  return { status: res.status, body, text };
}

async function login(email: string, password: string) {
  const r = await call("/api/auth/login", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  const token = (r.body as { data?: { token?: string } } | null)?.data?.token ?? null;
  return { status: r.status, token };
}

const d = new Date();
const pad = (n: number) => String(n).padStart(2, "0");
const today = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const auditFile = join(AUDIT_DIR, `audit-${today}.log`);

function readLog(): AuditRecord[] {
  try {
    return readFileSync(auditFile, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as AuditRecord);
  } catch {
    return [];
  }
}

function last(records: AuditRecord[], match: (r: AuditRecord) => boolean) {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i]!;
    if (match(r)) return r;
  }
  return null;
}

function rawText(): string {
  try {
    return readFileSync(auditFile, "utf8");
  } catch {
    return "";
  }
}

console.log(`\n=== AUDIT LOG TEST · ${BASE} ===`);
console.log(`Berkas: ${auditFile}\n`);

const owner = await login("owner@apoteku.test", "password123");
const kasir = await login("kasir@apoteku.test", "password123");
if (!owner.token || !kasir.token) {
  console.error("Gagal login. Pastikan server jalan dan DB sudah di-seed.");
  process.exit(1);
}
const ownerAuth = { Authorization: `Bearer ${owner.token}` };
const ownerJson = { ...ownerAuth, ...jsonHeaders };
const kasirAuth = { Authorization: `Bearer ${kasir.token}` };
const kasirJson = { ...kasirAuth, ...jsonHeaders };

/* 1. Autentikasi sukses */
{
  const r = last(
    readLog(),
    (x) => x.action === "auth.login" && x.outcome === "success" && x.actor?.email === "owner@apoteku.test",
  );
  add({
    code: "AUD-01",
    name: "Login sukses tercatat lengkap (aktor + role)",
    pass: !!r && r.actor?.role === "owner" && r.event === "auth",
    detail: r
      ? `action=${r.action} outcome=${r.outcome} actor=${r.actor?.email}/${r.actor?.role} ip=${r.ip}`
      : "tidak ditemukan",
  });
}

/* 2. Autentikasi gagal */
{
  const before = readLog().length;
  await login("kasir@apoteku.test", "password-salah");
  const after = readLog();
  const r = last(after, (x) => x.action === "auth.login" && x.outcome === "failure");
  add({
    code: "AUD-02",
    name: "Login gagal tercatat dengan alasan, tanpa aktor",
    pass:
      after.length > before &&
      !!r &&
      r.actor === null &&
      r.status === 401 &&
      r.detail?.reason === "password_salah",
    detail: r ? `status=${r.status} reason=${String(r.detail?.reason)} actor=${r.actor}` : "tidak ditemukan",
  });
}

/* 3. Redaksi rahasia */
{
  const text = rawText();
  const leaked = ["password123", "passwordHash", "$argon2", "dev-secret-change-me"].filter((s) =>
    text.includes(s),
  );
  add({
    code: "AUD-03",
    name: "Berkas audit tidak memuat password/token/secret",
    pass: leaked.length === 0,
    detail: leaked.length ? `bocor: ${leaked.join(", ")}` : "bersih",
  });
}

/* 4. Shift dibuka */
{
  let shiftId: number | null = null;
  const open = await call("/api/shifts/open", {
    method: "POST",
    headers: kasirJson,
    body: JSON.stringify({ openingCash: 150000 }),
  });
  if (open.status === 201) {
    shiftId = (open.body as { data?: { id?: number } })?.data?.id ?? null;
  } else {
    const cur = await call("/api/shifts/current", { headers: kasirAuth });
    shiftId = (cur.body as { data?: { id?: number } })?.data?.id ?? null;
  }
  const r = last(readLog(), (x) => x.action === "shift.open");
  add({
    code: "AUD-04",
    name: "Buka shift tercatat dengan uang awal",
    pass: !!r && typeof r.detail?.openingCash === "number" && r.actor?.email === "kasir@apoteku.test",
    detail: r ? `entity=${r.entity}#${r.entityId} openingCash=${String(r.detail?.openingCash)}` : "tidak ditemukan",
  });

  /* 5. Penjualan */
  const prod = await call("/api/products?perPage=1", { headers: kasirAuth });
  const productId = (prod.body as { data?: { id: number }[] } | null)?.data?.[0]?.id;
  if (productId) {
    const sale = await call("/api/sales", {
      method: "POST",
      headers: kasirJson,
      body: JSON.stringify({
        items: [{ productId, quantity: 1, unitPrice: 5000, discount: 0 }],
        payments: [{ method: "cash", amount: 10000 }],
        discount: 0,
        tax: 0,
      }),
    });
    const saleId = (sale.body as { data?: { id?: number; code?: string } } | null)?.data?.id;
    const r = last(readLog(), (x) => x.action === "sale.create");
    add({
      code: "AUD-05",
      name: "Penjualan tercatat dengan nota, total, dan shift",
      pass:
        !!r &&
        !!saleId &&
        r.entityId === saleId &&
        typeof r.detail?.total === "number" &&
        typeof r.detail?.shiftId === "number" &&
        r.actor?.email === "kasir@apoteku.test",
      detail: r
        ? `entityId=${r.entityId} code=${String(r.detail?.code)} total=${String(r.detail?.total)} shift=${String(r.detail?.shiftId)}`
        : "tidak ditemukan",
    });
  }

  /* 6. Tutup shift */
  if (shiftId) {
    await call(`/api/shifts/${shiftId}/close`, {
      method: "POST",
      headers: kasirJson,
      body: JSON.stringify({ closingCash: 150000 }),
    });
    const r = last(readLog(), (x) => x.action === "shift.close");
    add({
      code: "AUD-06",
      name: "Tutup shift tercatat dengan selisih kas",
      pass: !!r && r.entityId === shiftId && r.detail?.difference !== undefined,
      detail: r ? `entityId=${r.entityId} difference=${String(r.detail?.difference)}` : "tidak ditemukan",
    });
  }
}

/* 7. Penyesuaian stok */
{
  const apoteker = await login("apoteker@apoteku.test", "password123");
  const batches = await call("/api/inventory/batches?perPage=1", {
    headers: { Authorization: `Bearer ${apoteker.token}` },
  });
  const batchId = (batches.body as { data?: { id: number }[] } | null)?.data?.[0]?.id;
  if (batchId) {
    await call("/api/inventory/adjust", {
      method: "POST",
      headers: { Authorization: `Bearer ${apoteker.token}`, ...jsonHeaders },
      body: JSON.stringify({ batchId, type: "opname", quantity: 3, note: "uji audit" }),
    });
    const r = last(readLog(), (x) => x.action === "inventory.adjust");
    add({
      code: "AUD-07",
      name: "Penyesuaian stok tercatat dengan batch & jumlah",
      pass: !!r && r.entity === "batch" && r.entityId === batchId && r.detail?.quantityDelta === 3,
      detail: r ? `entityId=${r.entityId} delta=${String(r.detail?.quantityDelta)}` : "tidak ditemukan",
    });
  }
}

/* 8. Perubahan pengaturan */
{
  const cur = await call("/api/settings", { headers: ownerAuth });
  const name = (cur.body as { data?: { pharmacyName?: string } } | null)?.data?.pharmacyName;
  await call("/api/settings", {
    method: "PUT",
    headers: ownerJson,
    body: JSON.stringify({ pharmacyName: name ?? "Apoteku Sehat", taxPercent: 0 }),
  });
  const r = last(readLog(), (x) => x.action === "settings.update");
  add({
    code: "AUD-08",
    name: "Perubahan pengaturan tercatat dengan aktor owner",
    pass: !!r && r.actor?.role === "owner",
    detail: r ? `actor=${r.actor?.email} pharmacyName=${String(r.detail?.pharmacyName)}` : "tidak ditemukan",
  });
}

/* 9. Format berkas harian */
{
  const records = readLog();
  const allValid = records.every((r) => r.ts && r.action && r.outcome && "actor" in r);
  const sorted = records.every((r, i) => i === 0 || records[i - 1]!.ts <= r.ts);
  add({
    code: "AUD-09",
    name: "Berkas JSONL harian valid & berurutan waktu",
    pass: records.length > 0 && allValid && sorted,
    detail: `${records.length} baris · nama berkas=audit-${today}.log`,
  });
}

/* 10. Endpoint baca (owner) */
{
  const r = await call(`/api/audit?date=${today}&limit=500`, { headers: ownerAuth });
  const rows = (r.body as { data?: AuditRecord[] } | null)?.data ?? [];
  const actions = new Set(rows.map((x) => x.action));
  add({
    code: "AUD-10",
    name: "Owner dapat membaca log via API",
    pass: r.status === 200 && rows.length > 0 && actions.has("sale.create"),
    detail: `status=${r.status} kejadian=${rows.length} aksi=${[...actions].slice(0, 6).join(",")}`,
  });
}

/* 11. Filter */
{
  const r = await call(`/api/audit?date=${today}&action=auth.login&limit=500`, { headers: ownerAuth });
  const rows = (r.body as { data?: AuditRecord[] } | null)?.data ?? [];
  add({
    code: "AUD-11",
    name: "Filter aksi berjalan (action=auth.login)",
    pass: r.status === 200 && rows.length > 0 && rows.every((x) => x.action === "auth.login"),
    detail: `kejadian=${rows.length}`,
  });
}

/* 12. Daftar berkas harian */
{
  const r = await call("/api/audit/days", { headers: ownerAuth });
  const rows = (r.body as { data?: { date: string; size: number }[] } | null)?.data ?? [];
  add({
    code: "AUD-12",
    name: "Daftar berkas harian menampilkan tanggal hari ini",
    pass: r.status === 200 && rows.some((x) => x.date === today && x.size > 0),
    detail: rows.map((x) => `${x.date}(${x.size}B)`).join(", ") || "kosong",
  });
}

/* 13. Akses ditolak untuk kasir */
{
  const r = await call(`/api/audit?date=${today}`, { headers: kasirAuth });
  add({
    code: "AUD-13",
    name: "Kasir tidak boleh membaca jejak audit",
    pass: r.status === 403,
    detail: `status=${r.status}`,
  });
}

/* 14. Path traversal pada parameter tanggal */
{
  const attempts = ["..%2f..%2f.env", "../../etc/passwd", "2026-10", "abc"];
  const results = await Promise.all(
    attempts.map((a) => call(`/api/audit?date=${a}`, { headers: ownerAuth })),
  );
  const allRejected = results.every((r) => r.status === 400);
  add({
    code: "AUD-14",
    name: "Parameter tanggal tidak valid ditolak (tidak bisa baca file lain)",
    pass: allRejected,
    detail: attempts.map((a, i) => `${a}→${results[i]!.status}`).join(", "),
  });
}

/* --------------------------------- output ------------------------------- */

const pass = checks.filter((c) => c.pass).length;
const fail = checks.filter((c) => !c.pass);

console.log("KODE     HASIL  UJI");
console.log("-".repeat(92));
for (const c of checks) {
  console.log(`${c.code.padEnd(8)} ${(c.pass ? "PASS" : "FAIL").padEnd(6)} ${c.name}`);
  if (!c.pass) console.log(`${" ".repeat(15)}└─ ${c.detail}`);
}
console.log("-".repeat(92));
console.log(`Total: ${checks.length} · Lolos: ${pass} · Gagal: ${fail.length}\n`);

await Bun.write(
  `${import.meta.dir}/../docs/audit-result.json`,
  JSON.stringify({ base: BASE, at: new Date().toISOString(), file: auditFile, checks }, null, 2),
);

if (fail.length) process.exit(1);
