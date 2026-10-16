/**
 * E2E lapisan browser: menguji aplikasi web Apoteku seperti pengguna asli
 * (login → buka shift → jual obat → cetak struk → riwayat → tutup sesi)
 * memakai Chromium headless lewat Playwright.
 *
 * Jalankan:
 *   WEB_BASE=http://localhost:8080 bun run tools/e2e-browser.ts
 */
import { chromium, type Browser, type Page } from "playwright";
import { Checker } from "./e2e-common";

const WEB = (process.env.WEB_BASE ?? "http://localhost:8080").replace(/\/$/, "");

export async function runBrowserE2E(): Promise<Checker> {
  const c = new Checker(`E2E Browser (Chromium) · ${WEB}`);
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Jangan biarkan window.print() membuka dialog (tidak ada di headless).
    await context.addInitScript(() => {
      window.print = () => {};
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);

    /* ------------------------------------------------------------ B01 */
    {
      const res = await page.goto(WEB, { waitUntil: "domcontentloaded" });
      const server = res?.headers()["server"] ?? "";
      const rootFilled = await page
        .locator("#root > *")
        .first()
        .isVisible()
        .catch(() => false);
      const hasLogin = await page
        .getByRole("heading", { name: "Masuk ke Apoteku" })
        .isVisible()
        .catch(() => false);
      c.add(
        "E2E-B01",
        "Web tersaji (nginx) & aplikasi React berhasil dimuat",
        !!res && res.status() === 200 && rootFilled && hasLogin,
        `status=${res?.status()} server=${server} root=${rootFilled} formLogin=${hasLogin}`,
      );
    }

    /* ------------------------------------------------------------ B02 */
    {
      await page.fill("#email", "kasir@apoteku.test");
      await page.fill("#password", "password123");
      await page.getByRole("button", { name: "Masuk" }).click();

      await page
        .getByRole("link", { name: "Kasir", exact: true })
        .waitFor({ state: "visible" });
      const greeted = await page.getByText("Sari Kasir").first().isVisible();
      c.add(
        "E2E-B02",
        "Login lewat form berhasil & shell aplikasi tampil sebagai kasir",
        greeted,
        `pengguna terlihat=${greeted}`,
      );

      // Alamat API harus relatif (satu origin) → dibuktikan tidak ada permintaan
      // lintas origin ke :4000 selama sesi berjalan.
      const crossOrigin = await page.evaluate(() =>
        [...performance.getEntriesByType("resource")].some((e) =>
          /^https?:\/\/(localhost|127\.0\.0\.1):4000/.test(e.name),
        ),
      );
      c.add(
        "E2E-B03",
        "Aplikasi memanggil API lewat origin yang sama (tanpa CORS/port 4000)",
        !crossOrigin,
        crossOrigin ? "ada permintaan ke :4000 langsung" : "semua permintaan /api relatif",
      );
    }

    /* ------------------------------------------------------------ B04 */
    {
      await page.getByRole("link", { name: "Kasir", exact: true }).click();

      const search = page.locator('input[placeholder="Scan barcode atau cari nama obat..."]');
      const openShiftBtn = page.getByRole("button", { name: "Buka shift" });

      await Promise.race([
        search.waitFor({ state: "visible" }),
        openShiftBtn.waitFor({ state: "visible" }),
      ]);

      let opened = false;
      if (await openShiftBtn.isVisible().catch(() => false)) {
        await page.locator('input[type="number"]').first().fill("200000");
        await openShiftBtn.click();
        opened = true;
      }
      await search.waitFor({ state: "visible" });

      c.add(
        "E2E-B04",
        "Shift kasir dibuka dari UI, layar kasir siap menerima transaksi",
        await search.isVisible(),
        opened ? "shift baru dibuka (uang awal 200.000)" : "memakai shift yang sudah terbuka",
      );
    }

    /* ------------------------------------------------------------ B05 */
    {
      await page
        .locator('input[placeholder="Scan barcode atau cari nama obat..."]')
        .fill("Paracetamol");
      await page.getByText("Paracetamol 500mg").first().waitFor({ state: "visible" });
      c.add("E2E-B05", "Pencarian produk menampilkan hasil secara langsung", true, "Paracetamol 500mg ditemukan");
    }

    /* ------------------------------------------------------------ B06 */
    {
      const addBtn = page.locator("button", { hasText: "+ tablet" }).first();
      for (let i = 0; i < 3; i++) await addBtn.click();

      // Tombol bayar menampilkan total; 3 tablet × Rp700 = Rp2.100.
      const payBtn = page.getByRole("button", { name: /^Bayar/ });
      await payBtn.waitFor({ state: "visible" });
      const payText = (await payBtn.textContent()) ?? "";
      c.add(
        "E2E-B06",
        "Menambah 3 tablet ke keranjang menghitung total Rp2.100",
        /2[.\s]?100/.test(payText),
        `teks tombol="${payText.trim()}"`,
      );
    }

    /* ------------------------------------------------------------ B07 */
    {
      await page.locator('input[type="number"]').last().fill("5000");
      const changeVisible = await page.getByText(/Kembalian/).first().isVisible();
      const body = (await page.locator("body").innerText()).replace(/\u00a0/g, " ");
      c.add(
        "E2E-B07",
        "Kembalian dihitung otomatis (Rp5.000 − Rp2.100 = Rp2.900)",
        changeVisible && /2\.900/.test(body),
        `labelKembalian=${changeVisible} nilai2000=${/2\.900/.test(body)}`,
      );
    }

    /* ------------------------------------------------------------ B08 */
    let saleCode = "";
    {
      await page.getByRole("button", { name: /^Bayar/ }).click();
      const banner = page.locator("text=/Transaksi .+ berhasil/").first();
      await banner.waitFor({ state: "visible" });
      const text = (await banner.textContent()) ?? "";
      saleCode = text.match(/Transaksi\s+(\S+)\s+berhasil/)?.[1] ?? "";
      c.add(
        "E2E-B08",
        "Transaksi disimpan dari UI dan nota berhasil dibuat",
        !!saleCode,
        `teks="${text.trim()}" kode=${saleCode || "-"}`,
      );
    }

    /* ------------------------------------------------------------ B09 */
    {
      await page.getByRole("button", { name: "Cetak struk" }).click();
      await page.locator("#print-root .receipt").waitFor({ state: "visible" }).catch(() => {});
      const printed = (await page.locator("#print-root").innerText().catch(() => "")).replace(
        /\u00a0/g,
        " ",
      );
      const hasName = printed.includes("Apoteku Sehat");
      const hasReceiptNo = printed.includes("No. Nota") && printed.includes(saleCode);
      const hasTotal = /2\.100/.test(printed);
      c.add(
        "E2E-B09",
        "Struk 80mm tercetak dengan nama apotek, nomor nota, dan total",
        hasName && hasReceiptNo && hasTotal,
        `apotek=${hasName} noNota=${hasReceiptNo} total=${hasTotal}`,
      );
    }

    /* ------------------------------------------------------------ B10 */
    {
      await page.getByRole("link", { name: "Transaksi", exact: true }).click();
      await page.getByRole("heading", { name: "Transaksi" }).waitFor({ state: "visible" });
      // Tunggu sampai query riwayat selesai (polling teks halaman, bukan elemen).
      await page
        .waitForFunction((code) => document.body.innerText.includes(code), saleCode, {
          timeout: 15000,
        })
        .catch(() => {});
      const table = (await page.locator("table").first().innerText().catch(() => "")).replace(
        /\n+/g,
        " ",
      );
      const listed = table.includes(saleCode);
      c.add(
        "E2E-B10",
        "Nota baru muncul di riwayat transaksi",
        listed,
        listed ? `kode=${saleCode}` : `tidak ada di tabel; isi tabel: ${table.slice(0, 160)}`,
      );
    }

    /* ------------------------------------------------------------ B11 */
    {
      await page.getByRole("link", { name: "Shift Kasir", exact: true }).click();
      await page.getByRole("heading", { name: "Shift Kasir" }).waitFor({ state: "visible" });
      const body = (await page.locator("body").innerText()).replace(/\u00a0/g, " ");
      c.add(
        "E2E-B11",
        "Halaman shift menampilkan shift terbuka dengan uang awal 200.000",
        /200\.000/.test(body),
        `uangAwalTerlihat=${/200\.000/.test(body)}`,
      );
    }

    /* ------------------------------------------------------------ B12 */
    {
      // Deep link langsung ke sebuah rute → nginx harus melayani index.html.
      const res = await page.goto(`${WEB}/inventory`, { waitUntil: "domcontentloaded" });
      const ok = await page
        .getByRole("heading", { name: "Persediaan" })
        .isVisible()
        .catch(() => false);
      c.add(
        "E2E-B12",
        "Deep link SPA (/inventory) dilayani nginx tanpa 404",
        res?.status() === 200 && ok,
        `status=${res?.status()} halaman=${ok}`,
      );
    }

    /* ------------------------------------------------------------ B13 */
    {
      // Uji asap seluruh halaman: tidak ada yang boleh jatuh ke error boundary.
      const pages: [string, string][] = [
        ["/", "Dashboard"],
        ["/sales", "Transaksi"],
        ["/products", "Produk & Obat"],
        ["/inventory", "Persediaan"],
        ["/purchases", "Pembelian"],
        ["/prescriptions", "Resep"],
        ["/shift", "Shift Kasir"],
        ["/settings", "Pengaturan"],
      ];
      const broken: string[] = [];
      for (const [path, heading] of pages) {
        await page.goto(`${WEB}${path}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(700);
        const body = await page.locator("body").innerText();
        const crashed = body.includes("Something went wrong!");
        const titled = await page
          .getByRole("heading", { name: heading })
          .first()
          .isVisible()
          .catch(() => false);
        if (crashed || !titled) broken.push(`${path}${crashed ? " (crash)" : " (tanpa judul)"}`);
      }
      c.add(
        "E2E-B13",
        `Semua ${pages.length} halaman utama terbuka tanpa error boundary`,
        broken.length === 0,
        broken.length ? `bermasalah: ${broken.join(", ")}` : "seluruh halaman sehat",
      );
    }

    /* ------------------------------------------------------------ B14 */
    {
      await page.getByRole("button", { name: "Keluar" }).first().click();
      const backToLogin = await page
        .getByRole("heading", { name: "Masuk ke Apoteku" })
        .isVisible()
        .catch(() => false);
      c.add("E2E-B14", "Logout mengembalikan pengguna ke halaman masuk", backToLogin, `loginTampil=${backToLogin}`);
    }
  } catch (error) {
    c.fail(
      "E2E-B00",
      "Perjalanan browser selesai tanpa galat tak terduga",
      error instanceof Error ? error.message.split("\n")[0] : String(error),
    );
  } finally {
    await browser?.close();
  }

  return c;
}

if (import.meta.main) {
  const checker = await runBrowserE2E();
  checker.print();
  process.exit(checker.failed.length ? 1 : 0);
}
