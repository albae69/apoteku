/**
 * Stress test untuk API Apoteku.
 * Jalankan: bun run tools/loadtest.ts
 *
 * Opsi env:
 *   BASE=http://localhost:4000
 *   DUR=6000          durasi per skenario (ms)
 *   CONC=50           konkurensi default
 *   ONLY=sale-create  jalankan satu skenario saja
 *
 * Mengukur throughput, latensi (p50/p90/p95/p99), error rate, dan 5xx
 * untuk endpoint baca, tulis transaksional (POS), dan autentikasi.
 */

const BASE = process.env.BASE ?? "http://localhost:4000";
const DUR = Number(process.env.DUR ?? 6000);
const CONC = Number(process.env.CONC ?? 50);
const ONLY = process.env.ONLY ?? "";

type Stat = {
  name: string;
  concurrency: number;
  reqs: number;
  ok: number;
  client: number; // 4xx
  server: number; // 5xx
  netErr: number;
  rps: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  elapsedMs: number;
};

const results: Stat[] = [];

const pct = (sorted: number[], p: number) => {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[i]!;
};

async function load(
  name: string,
  concurrency: number,
  durationMs: number,
  make: () => { url: string; init: RequestInit },
): Promise<Stat> {
  const lat: number[] = [];
  let ok = 0;
  let client = 0;
  let server = 0;
  let netErr = 0;
  const deadline = performance.now() + durationMs;

  const worker = async () => {
    while (performance.now() < deadline) {
      const { url, init } = make();
      const t0 = performance.now();
      try {
        const res = await fetch(url, init);
        await res.arrayBuffer();
        lat.push(performance.now() - t0);
        if (res.status >= 500) server++;
        else if (res.status >= 400) client++;
        else ok++;
      } catch {
        lat.push(performance.now() - t0);
        netErr++;
      }
    }
  };

  const t0 = performance.now();
  await Promise.all(Array.from({ length: concurrency }, worker));
  const elapsedMs = performance.now() - t0;

  lat.sort((a, b) => a - b);
  const reqs = lat.length;
  const stat: Stat = {
    name,
    concurrency,
    reqs,
    ok,
    client,
    server,
    netErr,
    rps: reqs / (elapsedMs / 1000),
    p50: pct(lat, 50),
    p90: pct(lat, 90),
    p95: pct(lat, 95),
    p99: pct(lat, 99),
    max: lat[lat.length - 1] ?? 0,
    elapsedMs,
  };
  results.push(stat);
  printRow(stat);
  return stat;
}

const f = (n: number) => n.toFixed(1).padStart(7);
const i = (n: number) => String(n).padStart(6);

function printRow(s: Stat) {
  console.log(
    `${s.name.padEnd(22)} ${i(s.concurrency)} ${i(s.reqs)} ${f(s.rps)} ${f(s.p50)} ${f(s.p90)} ${f(s.p95)} ${f(s.p99)} ${f(s.max)} ${i(s.client)} ${i(s.server)} ${i(s.netErr)}`,
  );
}

function header() {
  console.log(
    `${"skenario".padEnd(22)} ${"conc".padStart(6)} ${"reqs".padStart(6)} ${"rps".padStart(7)} ${"p50".padStart(7)} ${"p90".padStart(7)} ${"p95".padStart(7)} ${"p99".padStart(7)} ${"max".padStart(7)} ${"4xx".padStart(6)} ${"5xx".padStart(6)} ${"err".padStart(6)}`,
  );
  console.log("-".repeat(110));
}

/* ------------------------------- setup --------------------------------- */

async function json(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, body };
}

const JH = { "Content-Type": "application/json" };

console.log(`\n=== STRESS TEST · ${BASE} · durasi ${DUR}ms/skenario ===\n`);

const login = await json("/api/auth/login", {
  method: "POST",
  headers: JH,
  body: JSON.stringify({ email: "kasir@apoteku.test", password: "password123" }),
});
const token = (login.body as { data?: { token?: string } } | null)?.data?.token;
if (!token) {
  console.error("Gagal login. Pastikan server jalan dan DB sudah di-seed.");
  process.exit(1);
}
const AUTH = { Authorization: `Bearer ${token}` };
const AUTH_JSON = { ...AUTH, ...JH };

// Pastikan ada shift terbuka agar penjualan bisa diproses.
await json("/api/shifts/open", {
  method: "POST",
  headers: AUTH_JSON,
  body: JSON.stringify({ openingCash: 200000 }),
});

// Ambil daftar id produk untuk lookup & penjualan.
const plist = await json("/api/products?perPage=100", { headers: AUTH });
const rows = (plist.body as { data?: { id: number; price?: number }[] } | null)?.data ?? [];
const ids = rows.map((r) => r.id);
if (!ids.length) {
  console.error("Tidak ada produk. Jalankan `bun run db:seed` dulu.");
  process.exit(1);
}
const pickId = () => ids[Math.floor(Math.random() * ids.length)]!;
const pickPrice = () => 5000;

const saleBody = () =>
  JSON.stringify({
    items: [{ productId: pickId(), quantity: 1, unitPrice: pickPrice(), discount: 0 }],
    payments: [{ method: "cash", amount: 100000 }],
    discount: 0,
    tax: 0,
  });

const scenarios: Record<string, () => Promise<void>> = {
  "read:products-list": () =>
    load("read:products-list", CONC, DUR, () => ({
      url: `${BASE}/api/products?perPage=20`,
      init: { headers: AUTH },
    })),

  "read:product-lookup": () =>
    load("read:product-lookup", CONC, DUR, () => ({
      url: `${BASE}/api/products/lookup?q=para&limit=10`,
      init: { headers: AUTH },
    })),

  "read:inventory-stock": () =>
    load("read:inventory-stock", CONC, DUR, () => ({
      url: `${BASE}/api/inventory/stock?perPage=50`,
      init: { headers: AUTH },
    })),

  "read:dashboard": () =>
    load("read:dashboard", CONC, DUR, () => ({
      url: `${BASE}/api/dashboard/summary`,
      init: { headers: AUTH },
    })),

  "auth:login": () =>
    load("auth:login", Math.min(CONC, 10), DUR, () => ({
      url: `${BASE}/api/auth/login`,
      init: {
        method: "POST",
        headers: JH,
        body: JSON.stringify({ email: "kasir@apoteku.test", password: "password123" }),
      },
    })),

  "write:sale-create": () =>
    load("write:sale-create", CONC, DUR, () => ({
      url: `${BASE}/api/sales`,
      init: { method: "POST", headers: AUTH_JSON, body: saleBody() },
    })),

  "ramp:products-list": async () => {
    for (const c of [1, 10, 50, 100, 200]) {
      await load(`ramp:products c=${c}`, c, Math.min(DUR, 4000), () => ({
        url: `${BASE}/api/products?perPage=20`,
        init: { headers: AUTH },
      }));
    }
  },
};

/* -------------------------------- run ---------------------------------- */

header();
const names = ONLY ? [ONLY] : Object.keys(scenarios);
for (const name of names) {
  const fn = scenarios[name];
  if (!fn) {
    console.error(`Skenario tidak dikenal: ${name}`);
    continue;
  }
  await fn();
}

const total = results.reduce((s, r) => s + r.reqs, 0);
const server = results.reduce((s, r) => s + r.server, 0);
const client = results.reduce((s, r) => s + r.client, 0);
const netErr = results.reduce((s, r) => s + r.netErr, 0);
console.log("-".repeat(110));
console.log(
  `TOTAL req=${total} · 4xx=${client} · 5xx=${server} · network-error=${netErr}`,
);

await Bun.write(
  `${import.meta.dir}/../docs/loadtest-result.json`,
  JSON.stringify({ base: BASE, at: new Date().toISOString(), dur: DUR, results }, null, 2),
);
console.log("\nHasil detail: docs/loadtest-result.json\n");
