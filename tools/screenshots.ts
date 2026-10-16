/**
 * Menangkap screenshot aplikasi Apoteku untuk panduan pengguna (docs/panduan-pengguna.tex).
 *
 * Prasyarat: stack sedang hidup (lihat docker-compose.e2e.yml), lalu:
 *   docker compose -f docker-compose.e2e.yml up -d mysql api web
 *   WEB_BASE=http://localhost:8080 bun run tools/screenshots.ts
 *
 * Hasil: docs/images/*.png
 */
import { chromium, type Page } from "playwright";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

const WEB = (process.env.WEB_BASE ?? "http://localhost:8080").replace(/\/$/, "");
const OUT = process.env.OUT_DIR ?? join("docs", "images");
const EMAIL = process.env.EMAIL ?? "kasir@apoteku.test";
const PASSWORD = process.env.PASSWORD ?? "password123";

const taken: string[] = [];

/**
 * Simpan satu screenshot ke OUT/<name>.png.
 * Tinggi jendela dipangkas mengikuti isi halaman agar tidak menyisakan banyak
 * ruang kosong (kecuali `fixedHeight` diberikan).
 */
async function shot(page: Page, name: string, note: string, fixedHeight?: number): Promise<void> {
  const height =
    fixedHeight ??
    (await page.evaluate(() => {
      const main = document.querySelector("main");
      if (!main) return document.documentElement.scrollHeight;
      const padBottom = parseFloat(getComputedStyle(main).paddingBottom) || 0;
      let bottom = main.getBoundingClientRect().top;
      for (const child of Array.from(main.children)) {
        bottom = Math.max(bottom, child.getBoundingClientRect().bottom);
      }
      return Math.ceil(bottom + padBottom + 8);
    }));

  await page.setViewportSize({ width: 1360, height: Math.min(Math.max(height, 560), 1000) });
  await page.waitForTimeout(160);
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  taken.push(`${name.padEnd(24)} ${note}`);
}

/** Buka rute SPA, tunggu judul halaman tampil, lalu beri waktu data termuat. */
async function open(page: Page, path: string, heading: string): Promise<void> {
  await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded" });
  await page
    .getByRole("heading", { name: heading, exact: true })
    .first()
    .waitFor({ state: "visible" });
  await page.waitForTimeout(900);
}

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const context = await browser.newContext({
    viewport: { width: 1360, height: 900 },
    deviceScaleFactor: 2,
    locale: "id-ID",
  });
  // Jangan biarkan window.print() membuka dialog di headless.
  await context.addInitScript(() => {
    (window as unknown as { print: () => void }).print = () => {};
  });

  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    /* ---------------------------------------------------------- halaman masuk */
    await page.goto(WEB, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Masuk ke Apoteku" }).waitFor({ state: "visible" });
    await page.waitForTimeout(400);
    await shot(page, "01-halaman-masuk", "Halaman masuk", 620);

    /* ------------------------------------------------------------------- login */
    await page.fill("#email", EMAIL);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Masuk" }).click();
    await page.getByRole("link", { name: "Kasir", exact: true }).waitFor({ state: "visible" });

    /* --------------------------------------------------------- shift kasir */
    await open(page, "/shift", "Shift Kasir");
    const openBtn = page.getByRole("button", { name: "Buka shift" });
    if (await openBtn.isVisible().catch(() => false)) {
      await shot(page, "shift-buka", "Shift Kasir — form buka shift");
      await page.locator('input[type="number"]').first().fill("200000");
      await openBtn.click();
      await page.waitForTimeout(1400);
    }
    await shot(page, "shift-terbuka", "Shift Kasir — ringkasan shift terbuka");

    /* --------------------------------------------------------------- kasir */
    await open(page, "/pos", "Kasir");
    await page
      .locator('input[placeholder="Scan barcode atau cari nama obat..."]')
      .fill("Paracetamol");
    await page.getByText("Paracetamol 500mg").first().waitFor({ state: "visible" });
    const addBtn = page.locator("button", { hasText: "+ tablet" }).first();
    for (let i = 0; i < 3; i++) await addBtn.click();
    await page.locator('input[type="number"]').last().fill("5000");
    await page.waitForTimeout(500);
    await shot(page, "kasir-keranjang", "Kasir — keranjang & kembalian");

    await page.getByRole("button", { name: /^Bayar/ }).click();
    await page.locator("text=/Transaksi .+ berhasil/").first().waitFor({ state: "visible" });
    await page.waitForTimeout(700);
    await shot(page, "kasir-berhasil", "Kasir — transaksi berhasil");

    /* ----------------------------------------------------------- transaksi */
    await open(page, "/sales", "Transaksi");
    await shot(page, "transaksi", "Transaksi — riwayat penjualan");
    await page.getByRole("button", { name: "Struk", exact: true }).first().click();
    await page.locator(".receipt").first().waitFor({ state: "visible" });
    await page.waitForTimeout(600);
    await shot(page, "transaksi-struk", "Transaksi — pratinjau & cetak struk");

    /* ------------------------------------------------------------ dashboard */
    await open(page, "/", "Dashboard");
    await shot(page, "dashboard", "Dashboard");

    /* --------------------------------------------------------------- produk */
    await open(page, "/products", "Produk & Obat");
    await shot(page, "produk", "Produk & Obat — daftar");
    await page.getByRole("button", { name: "Tambah produk" }).click();
    await page.waitForTimeout(500);
    await shot(page, "produk-form", "Produk & Obat — form tambah produk");

    /* ------------------------------------------------------------ persediaan */
    await open(page, "/inventory", "Persediaan");
    await shot(page, "persediaan-stok", "Persediaan — tab Stok Produk");
    await page.getByRole("button", { name: "Batch & Expiry", exact: true }).click();
    await page.waitForTimeout(700);
    await shot(page, "persediaan-batch", "Persediaan — tab Batch & Expiry");
    await page.getByRole("button", { name: "Peringatan", exact: true }).click();
    await page.waitForTimeout(700);
    await shot(page, "persediaan-peringatan", "Persediaan — tab Peringatan");

    /* ------------------------------------------------------------- pembelian */
    await open(page, "/purchases", "Pembelian");
    await shot(page, "pembelian", "Pembelian — daftar PO");
    await page.getByRole("button", { name: "Buat PO" }).click();
    await page.waitForTimeout(500);
    await shot(page, "pembelian-po", "Pembelian — form purchase order");

    /* ----------------------------------------------------------------- resep */
    await open(page, "/prescriptions", "Resep");
    await shot(page, "resep", "Resep — daftar");
    await page.getByRole("button", { name: "Input resep" }).click();
    await page.waitForTimeout(500);
    await shot(page, "resep-form", "Resep — form input resep");

    /* ------------------------------------------------------------ pengaturan */
    await open(page, "/settings", "Pengaturan");
    await shot(page, "pengaturan", "Pengaturan");

    console.log(`\n${taken.length} screenshot tersimpan di ${OUT}/`);
    for (const t of taken) console.log(`  ${t}`);
  } finally {
    await browser.close();
  }
}

await main();
