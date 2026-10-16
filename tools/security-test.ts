/**
 * Security test untuk API Apoteku.
 * Jalankan: bun run tools/security-test.ts
 *
 * Menguji: autentikasi/JWT, otorisasi/RBAC, IDOR, injeksi, mass assignment,
 * kebocoran error, CORS, rate limiting, dan security headers.
 */
import { createHmac } from "node:crypto";

const BASE = process.env.BASE ?? "http://localhost:4000";
const SECRET = process.env.JWT_SECRET ?? "dev-secret-change-me";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

type Severity = "info" | "low" | "medium" | "high";
type Check = {
  code: string;
  name: string;
  pass: boolean;
  detail: string;
  severity: Severity; // tingkat risiko bila GAGAL
};

const checks: Check[] = [];
const add = (c: Check) => checks.push(c);

/* ------------------------------- helpers ------------------------------- */

const b64url = (input: string) =>
  Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: "HS256", typ: "JWT" },
  signature?: string,
) {
  const data = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig =
    signature ??
    b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig === "" ? "" : sig}`;
}

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* bukan JSON */
  }
  return { status: res.status, headers: res.headers, text, json };
}

const jsonHeaders = { "Content-Type": "application/json" };

async function login(email: string, password: string) {
  const res = await call("/api/auth/login", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({ email, password }),
  });
  const body = res.json as { data?: { token?: string } } | null;
  return { status: res.status, token: body?.data?.token ?? null, raw: res.text };
}

/* ------------------------------- runner -------------------------------- */

console.log(`\n=== SECURITY TEST · ${BASE} ===\n`);

const kasir = await login("kasir@apoteku.test", "password123");
if (!kasir.token) {
  console.error("Gagal login sebagai kasir. Pastikan server jalan dan DB sudah di-seed.");
  process.exit(1);
}
const AUTH = { Authorization: `Bearer ${kasir.token}` };
const authJson = { ...AUTH, ...jsonHeaders };

/* 1. Autentikasi dasar */
{
  const r = await call("/api/products");
  add({
    code: "AUTH-01",
    name: "Endpoint terproteksi tanpa token → 401",
    pass: r.status === 401,
    detail: `status=${r.status}`,
    severity: "high",
  });
}
{
  const r = await call("/api/products", {
    headers: { Authorization: "Bearer not-a-jwt" },
  });
  add({
    code: "AUTH-02",
    name: "Token malformed → 401",
    pass: r.status === 401,
    detail: `status=${r.status}`,
    severity: "high",
  });
}
{
  const tampered = `${kasir.token.slice(0, -1)}${kasir.token.endsWith("A") ? "B" : "A"}`;
  const r = await call("/api/products", {
    headers: { Authorization: `Bearer ${tampered}` },
  });
  add({
    code: "AUTH-03",
    name: "Token dirusak (signature diubah) → 401",
    pass: r.status === 401,
    detail: `status=${r.status}`,
    severity: "high",
  });
}
{
  const forged = signJwt(
    { sub: 1, role: "owner", exp: Math.floor(Date.now() / 1000) + 3600 },
    "wrong-secret",
  );
  const r = await call("/api/products", {
    headers: { Authorization: `Bearer ${forged}` },
  });
  add({
    code: "AUTH-04",
    name: "Token ditandatangani secret salah → 401",
    pass: r.status === 401,
    detail: `status=${r.status}`,
    severity: "high",
  });
}
{
  // Serangan klasik: header alg=none + signature kosong.
  const forged = signJwt(
    { sub: 1, role: "owner", exp: Math.floor(Date.now() / 1000) + 3600 },
    SECRET,
    { alg: "none", typ: "JWT" },
    "",
  );
  const r = await call("/api/products", {
    headers: { Authorization: `Bearer ${forged}` },
  });
  add({
    code: "AUTH-05",
    name: 'Algoritma "alg=none" ditolak → 401',
    pass: r.status === 401,
    detail: `status=${r.status}`,
    severity: "high",
  });
}
{
  const expired = signJwt(
    { sub: 1, role: "owner", exp: Math.floor(Date.now() / 1000) - 60 },
    SECRET,
  );
  const r = await call("/api/products", {
    headers: { Authorization: `Bearer ${expired}` },
  });
  add({
    code: "AUTH-06",
    name: "Token kedaluwarsa ditolak → 401",
    pass: r.status === 401,
    detail: `status=${r.status}`,
    severity: "high",
  });
}
{
  const r = await call("/api/products", { headers: AUTH });
  add({
    code: "AUTH-07",
    name: "Token valid diterima → 200",
    pass: r.status === 200,
    detail: `status=${r.status}`,
    severity: "info",
  });
}
{
  const r = await call("/health");
  add({
    code: "AUTH-08",
    name: "/health publik (tidak butuh token) → 200",
    pass: r.status === 200,
    detail: `status=${r.status}`,
    severity: "info",
  });
}

/* 2. Kebocoran kredensial */
{
  const leak = /password(Hash|_hash)/i.test(kasir.raw);
  add({
    code: "LEAK-01",
    name: "Respons login tidak membocorkan hash password",
    pass: !leak,
    detail: leak ? "ditemukan passwordHash di respons" : "bersih",
    severity: "high",
  });
}
{
  const me = await call("/api/auth/me", { headers: AUTH });
  const leak = /password(Hash|_hash)/i.test(me.text);
  add({
    code: "LEAK-02",
    name: "/auth/me tidak membocorkan hash password",
    pass: !leak,
    detail: leak ? "ditemukan passwordHash" : "bersih",
    severity: "high",
  });
}

/* 3. Kebocoran detail error internal */
{
  // supplier_id tidak ada → memicu error foreign key di server.
  const r = await call("/api/purchases", {
    method: "POST",
    headers: authJson,
    body: JSON.stringify({
      supplierId: 999999,
      orderDate: "2026-01-01",
      items: [{ productId: 1, quantity: 1, unitCost: 100 }],
    }),
  });
  const leaked = /sqlMessage|ER_NO_REFERENCED|at Object\.|node_modules|stack/i.test(r.text);
  add({
    code: "LEAK-03",
    name: "Error internal tidak membocorkan detail SQL/stack trace",
    pass: !leaked,
    detail: `status=${r.status} · bocor=${leaked} · body=${r.text.slice(0, 80)}`,
    severity: "medium",
  });
}

/* 4. Injeksi */
{
  const q = encodeURIComponent("' OR 1=1 -- ");
  const r = await call(`/api/products?q=${q}`, { headers: AUTH });
  const body = r.json as { data?: unknown[] } | null;
  add({
    code: "INJ-01",
    name: "SQL injection pada parameter ?q= tidak berdampak",
    pass: r.status === 200 && (body?.data?.length ?? -1) === 0,
    detail: `status=${r.status} · hasil=${body?.data?.length}`,
    severity: "high",
  });
}
{
  const q = encodeURIComponent("'; DROP TABLE products; -- ");
  const r = await call(`/api/products?q=${q}`, { headers: AUTH });
  const after = await call("/api/products?perPage=1", { headers: AUTH });
  const body = after.json as { meta?: { total?: number } } | null;
  add({
    code: "INJ-02",
    name: "Upaya DROP TABLE via parameter tidak menghapus data",
    pass: r.status === 200 && (body?.meta?.total ?? 0) > 0,
    detail: `status=${r.status} · total produk masih ${body?.meta?.total}`,
    severity: "high",
  });
}
{
  const r = await call("/api/products/1%20OR%201=1", { headers: AUTH });
  add({
    code: "INJ-03",
    name: "ID non-numerik tidak memicu error 500",
    pass: r.status !== 500,
    detail: `status=${r.status}`,
    severity: "medium",
  });
}

/* 5. Mass assignment */
{
  // Data dibuat oleh owner (kasir sudah dibatasi), inti uji: field berlebih diabaikan.
  const owner = await login("owner@apoteku.test", "password123");
  const ownerJson = { Authorization: `Bearer ${owner.token}`, ...jsonHeaders };
  const r = await call("/api/master/categories", {
    method: "POST",
    headers: ownerJson,
    body: JSON.stringify({
      name: "Kategori Uji",
      id: 999999,
      role: "owner",
      createdAt: "2000-01-01T00:00:00.000Z",
    }),
  });
  const body = r.json as { data?: { id?: number; role?: string } } | null;
  const bad = body?.data?.id === 999999 || "role" in (body?.data ?? {});
  add({
    code: "MASS-01",
    name: "Field berlebih (id/role) diabaikan saat create",
    pass: r.status === 201 && !bad,
    detail: `status=${r.status} · id=${body?.data?.id}`,
    severity: "medium",
  });
  if (body?.data?.id) {
    await call(`/api/master/categories/${body.data.id}`, {
      method: "DELETE",
      headers: ownerJson,
    });
  }
}

/* 6. RBAC / otorisasi */
{
  // Kasir seharusnya tidak boleh mengubah pengaturan apotek.
  const before = await call("/api/settings", { headers: AUTH });
  const beforeName = (before.json as { data?: { pharmacyName?: string } } | null)?.data
    ?.pharmacyName;
  const r = await call("/api/settings", {
    method: "PUT",
    headers: authJson,
    body: JSON.stringify({ pharmacyName: "DIUBAH KASIR", taxPercent: 0 }),
  });
  const after = await call("/api/settings", { headers: AUTH });
  const afterName = (after.json as { data?: { pharmacyName?: string } } | null)?.data
    ?.pharmacyName;
  const changed = afterName !== beforeName;
  add({
    code: "RBAC-01",
    name: "Role kasir tidak boleh mengubah pengaturan apotek",
    pass: r.status === 403 && !changed,
    detail: `status=${r.status} · nama berubah=${changed} (${beforeName} → ${afterName})`,
    severity: "high",
  });
}
{
  // Owner tetap boleh mengubah pengaturan (memastikan guard tidak kebablasan).
  const before = await call("/api/settings", { headers: AUTH });
  const beforeName = (before.json as { data?: { pharmacyName?: string } } | null)?.data
    ?.pharmacyName;
  const owner = await login("owner@apoteku.test", "password123");
  const r = await call("/api/settings", {
    method: "PUT",
    headers: { Authorization: `Bearer ${owner.token}`, ...jsonHeaders },
    body: JSON.stringify({ pharmacyName: `${beforeName} (uji)`, taxPercent: 0 }),
  });
  await call("/api/settings", {
    method: "PUT",
    headers: { Authorization: `Bearer ${owner.token}`, ...jsonHeaders },
    body: JSON.stringify({ pharmacyName: beforeName ?? "Apoteku Sehat", taxPercent: 0 }),
  });
  add({
    code: "RBAC-02",
    name: "Role owner tetap boleh mengubah pengaturan",
    pass: r.status === 200,
    detail: `status=${r.status}`,
    severity: "info",
  });
}
{
  // Kasir menghapus master data seharusnya ditolak (data dibuat oleh owner).
  const owner = await login("owner@apoteku.test", "password123");
  const ownerJson = { Authorization: `Bearer ${owner.token}`, ...jsonHeaders };
  const created = await call("/api/master/doctors", {
    method: "POST",
    headers: ownerJson,
    body: JSON.stringify({ name: "dr. Sementara" }),
  });
  const id = (created.json as { data?: { id?: number } } | null)?.data?.id;
  if (!id) {
    add({
      code: "RBAC-03",
      name: "Role kasir tidak boleh menghapus master data",
      pass: false,
      detail: `gagal menyiapkan data (create status=${created.status})`,
      severity: "medium",
    });
  } else {
    const del = await call(`/api/master/doctors/${id}`, {
      method: "DELETE",
      headers: AUTH,
    });
    add({
      code: "RBAC-03",
      name: "Role kasir tidak boleh menghapus master data",
      pass: del.status === 403,
      detail: `status=${del.status}`,
      severity: "medium",
    });
    // Bersihkan dengan owner.
    await call(`/api/master/doctors/${id}`, { method: "DELETE", headers: ownerJson });
  }
}

/* 7. IDOR / kepemilikan resource */
{
  const apoteker = await login("apoteker@apoteku.test", "password123");
  if (apoteker.token) {
    const aAuth = { Authorization: `Bearer ${apoteker.token}`, ...jsonHeaders };
    const open = await call("/api/shifts/open", {
      method: "POST",
      headers: { Authorization: `Bearer ${apoteker.token}`, ...jsonHeaders },
      body: JSON.stringify({ openingCash: 10000 }),
    });
    let shiftId = (open.json as { data?: { id?: number } } | null)?.data?.id;
    if (!shiftId) {
      const cur = await call("/api/shifts/current", {
        headers: { Authorization: `Bearer ${apoteker.token}` },
      });
      shiftId = (cur.json as { data?: { id?: number } } | null)?.data?.id;
    }
    if (shiftId) {
      const close = await call(`/api/shifts/${shiftId}/close`, {
        method: "POST",
        headers: authJson, // kasir menutup shift milik apoteker
        body: JSON.stringify({ closingCash: 10000 }),
      });
      add({
        code: "IDOR-01",
        name: "Kasir tidak boleh menutup shift milik user lain",
        pass: close.status === 403,
        detail: `status=${close.status} (shift#${shiftId} milik apoteker)`,
        severity: "medium",
      });
    }
    void aAuth;
  }
}

/* 8. CORS */
{
  const r = await call("/api/products", {
    headers: { ...AUTH, Origin: "https://evil.example" },
  });
  const acao = r.headers.get("access-control-allow-origin");
  add({
    code: "CORS-01",
    name: "Origin asing tidak diizinkan CORS",
    pass: acao === null || !acao.includes("evil.example"),
    detail: `Access-Control-Allow-Origin=${acao ?? "(tidak ada)"}`,
    severity: "high",
  });
}
{
  const r = await call("/api/products", {
    headers: { ...AUTH, Origin: WEB_ORIGIN },
  });
  const acao = r.headers.get("access-control-allow-origin");
  add({
    code: "CORS-02",
    name: "Origin resmi web diizinkan",
    pass: acao === WEB_ORIGIN,
    detail: `Access-Control-Allow-Origin=${acao ?? "(tidak ada)"}`,
    severity: "info",
  });
}

/* 9. Security headers */
{
  const r = await call("/api/products", { headers: AUTH });
  const wanted = [
    "x-content-type-options",
    "x-frame-options",
    "content-security-policy",
    "referrer-policy",
    "strict-transport-security",
  ];
  const missing = wanted.filter((h) => !r.headers.get(h));
  add({
    code: "HDR-01",
    name: "Security headers terpasang",
    pass: missing.length === 0,
    detail: missing.length ? `belum ada: ${missing.join(", ")}` : "semua ada",
    severity: "low",
  });
}

/* 10. Rate limiting pada login */
{
  const attempts = 30;
  let ok = 0;
  let limited = 0;
  const start = Date.now();
  await Promise.all(
    Array.from({ length: attempts }, async () => {
      const r = await call("/api/auth/login", {
        method: "POST",
        headers: jsonHeaders,
        body: JSON.stringify({ email: "kasir@apoteku.test", password: "salah-terus" }),
      });
      if (r.status === 429) limited++;
      else if (r.status === 401) ok++;
    }),
  );
  add({
    code: "RATE-01",
    name: "Brute force login dibatasi (rate limit/429)",
    pass: limited > 0,
    detail: `${attempts} percobaan → 401=${ok}, 429=${limited}, ${Date.now() - start}ms`,
    severity: "high",
  });
}

/* ------------------------------- output -------------------------------- */

const pass = checks.filter((c) => c.pass).length;
const fail = checks.filter((c) => !c.pass);

console.log("KODE     HASIL  KEPARAHAN  UJI");
console.log("-".repeat(96));
for (const c of checks) {
  console.log(
    `${c.code.padEnd(8)} ${(c.pass ? "PASS" : "FAIL").padEnd(6)} ${c.severity
      .toUpperCase()
      .padEnd(10)} ${c.name}`,
  );
  if (!c.pass) console.log(`${" ".repeat(27)}└─ ${c.detail}`);
}
console.log("-".repeat(96));
console.log(`Total: ${checks.length} · Lolos: ${pass} · Gagal: ${fail.length}`);
if (fail.length) {
  console.log(
    `Temuan: ${fail
      .map((c) => `${c.code}(${c.severity})`)
      .join(", ")}`,
  );
}

await Bun.write(
  `${import.meta.dir}/../docs/security-result.json`,
  JSON.stringify({ base: BASE, at: new Date().toISOString(), checks }, null, 2),
);
console.log("\nHasil detail: docs/security-result.json\n");
