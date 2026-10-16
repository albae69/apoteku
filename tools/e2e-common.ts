/**
 * Utilitas bersama untuk pengujian end-to-end Apoteku.
 * Dipakai oleh tools/e2e-api.ts dan tools/e2e-browser.ts.
 */

export type Check = {
  code: string;
  name: string;
  pass: boolean;
  detail: string;
};

export type SuiteResult = {
  suite: string;
  at: string;
  passed: number;
  failed: number;
  checks: Check[];
};

/** Pengumpul hasil uji dengan keluaran tabel yang ringkas. */
export class Checker {
  readonly checks: Check[] = [];

  constructor(readonly suite: string) {}

  add(code: string, name: string, pass: boolean, detail = ""): boolean {
    this.checks.push({ code, name, pass, detail });
    return pass;
  }

  fail(code: string, name: string, detail: string) {
    return this.add(code, name, false, detail);
  }

  get failed(): Check[] {
    return this.checks.filter((c) => !c.pass);
  }

  get passed(): number {
    return this.checks.length - this.failed.length;
  }

  print(): void {
    console.log(`\n=== ${this.suite} ===`);
    console.log("KODE      HASIL  UJI");
    console.log("-".repeat(96));
    for (const c of this.checks) {
      console.log(`${c.code.padEnd(9)} ${(c.pass ? "PASS" : "FAIL").padEnd(6)} ${c.name}`);
      if (c.detail) console.log(`${" ".repeat(17)}└─ ${c.detail}`);
    }
    console.log("-".repeat(96));
    console.log(`Total: ${this.checks.length} · Lolos: ${this.passed} · Gagal: ${this.failed.length}\n`);
  }

  toResult(): SuiteResult {
    return {
      suite: this.suite,
      at: new Date().toISOString(),
      passed: this.passed,
      failed: this.failed.length,
      checks: this.checks,
    };
  }
}

export type HttpResult = {
  status: number;
  body: any;
  text: string;
};

/** Panggil API dan baca JSON (tanpa pernah melempar error HTTP). */
export async function http(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<HttpResult> {
  const res = await fetch(`${base}${path}`, init);
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text };
}

export function json(token?: string | null): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** Login dan kembalikan token + profil. */
export async function login(
  base: string,
  email: string,
  password: string,
): Promise<{ status: number; token: string | null; user: any }> {
  const r = await http(base, "/api/auth/login", {
    method: "POST",
    headers: json(),
    body: JSON.stringify({ email, password }),
  });
  return {
    status: r.status,
    token: r.body?.data?.token ?? null,
    user: r.body?.data?.user ?? null,
  };
}

/** Bulatkan 2 desimal seperti API, supaya perbandingan angka tepat. */
export const r2 = (n: number) => Math.round(n * 100) / 100;

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Tanggal lokal YYYY-MM-DD (mengikuti helper server). */
export function localDate(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}
