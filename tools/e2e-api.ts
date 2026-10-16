/**
 * E2E lapisan API: menjalankan perjalanan bisnis apotek yang sesungguhnya
 * terhadap stack yang berjalan (login → master data → pembelian → stok →
 * shift → penjualan FEFO → resep → rekonsiliasi kas → audit).
 *
 * Jalankan:
 *   API_BASE=http://localhost:4000 bun run tools/e2e-api.ts
 * Di dalam Docker (lihat docker-compose.e2e.yml) dipanggil oleh tools/e2e.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  Checker,
  addDays,
  http,
  json,
  localDate,
  login,
  r2,
} from "./e2e-common";

const API = (process.env.API_BASE ?? "http://localhost:4000").replace(/\/$/, "");
const AUDIT_DIR = process.env.AUDIT_DIR ?? "apps/api/logs/audit";

type Tokens = { owner: string; kasir: string; apoteker: string };

export async function runApiE2E(): Promise<Checker> {
  const c = new Checker(`E2E API · ${API}`);
  const call = (path: string, init?: RequestInit) => http(API, path, init);
  const stamp = Date.now().toString().slice(-6);

  /* ---------------------------------------------------------------- A01 */
  {
    const r = await call("/health");
    c.add(
      "E2E-A01",
      "API sehat dan siap menerima permintaan",
      r.status === 200 && r.body?.status === "ok",
      `status=${r.status} body=${r.text.slice(0, 60)}`,
    );
  }

  /* ---------------------------------------------------------------- A02 */
  let t: Tokens = { owner: "", kasir: "", apoteker: "" };
  {
    const [owner, kasir, apoteker] = await Promise.all([
      login(API, "owner@apoteku.test", "password123"),
      login(API, "kasir@apoteku.test", "password123"),
      login(API, "apoteker@apoteku.test", "password123"),
    ]);
    const wrong = await login(API, "owner@apoteku.test", "password-salah");
    t = {
      owner: owner.token ?? "",
      kasir: kasir.token ?? "",
      apoteker: apoteker.token ?? "",
    };
    c.add(
      "E2E-A02",
      "Login tiga role berhasil, password salah ditolak",
      !!t.owner && !!t.kasir && !!t.apoteker && wrong.status === 401,
      `owner=${owner.status} kasir=${kasir.status} apoteker=${apoteker.status} salah=${wrong.status}`,
    );
    if (!t.owner || !t.kasir || !t.apoteker) {
      c.fail("E2E-A02b", "Prasyarat token ketiga role", "uji lanjutan dilewati");
      return c;
    }
  }

  /* ---------------------------------------------------------------- A03 */
  {
    const body = JSON.stringify({
      sku: `E2E-${stamp}`,
      name: "Produk Uji E2E",
      form: "tablet",
      drugClass: "obat_bebas",
      baseUnit: "tablet",
      salePrice: 2000,
      costPrice: 1000,
      minStock: 0,
      units: [
        { name: "tablet", conversion: 1, isBase: true },
        { name: "strip", conversion: 10, price: 18000 },
      ],
    });
    const asKasir = await call("/api/products", {
      method: "POST",
      headers: json(t.kasir),
      body,
    });
    const asOwner = await call("/api/products", {
      method: "POST",
      headers: json(t.owner),
      body,
    });
    c.add(
      "E2E-A03",
      "RBAC: kasir ditolak, owner boleh membuat produk",
      asKasir.status === 403 && asOwner.status === 201,
      `kasir=${asKasir.status} owner=${asOwner.status}`,
    );

    /* -------------------------------------------------------------- A04 */
    const supplier = await call("/api/master/suppliers", {
      method: "POST",
      headers: json(t.owner),
      body: JSON.stringify({ name: `PT Uji E2E ${stamp}`, contactPerson: "Budi" }),
    });
    const customer = await call("/api/master/customers", {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({ name: `Pelanggan Uji ${stamp}`, isMember: true }),
    });
    c.add(
      "E2E-A04",
      "Master data terbentuk (supplier oleh owner, pelanggan oleh kasir)",
      supplier.status === 201 && customer.status === 201,
      `supplier=${supplier.status} customer=${customer.status}`,
    );

    /* -------------------------------------------------------------- A05 */
    const productId = asOwner.body?.data?.id as number;
    const detail = await call(`/api/products/${productId}`, { headers: json(t.kasir) });
    const units = detail.body?.data?.units ?? [];
    const strip = units.find((u: any) => u.name === "strip");
    c.add(
      "E2E-A05",
      "Produk multi-satuan tersimpan & terbaca kembali",
      detail.status === 200 && units.length === 2 && strip?.conversion === 10,
      `units=${units.map((u: any) => `${u.name}×${u.conversion}`).join(", ")}`,
    );

    /* -------------------------------------------------------------- A06 */
    const supplierId = supplier.body?.data?.id as number;
    const po = await call("/api/purchases", {
      method: "POST",
      headers: json(t.apoteker),
      body: JSON.stringify({
        supplierId,
        orderDate: localDate(),
        items: [
          {
            productId,
            batchNumber: `E2E-B-${stamp}`,
            expiryDate: localDate(addDays(new Date(), 200)),
            quantity: 50,
            unitCost: 1100,
          },
        ],
      }),
    });
    const poId = po.body?.data?.id as number;
    const receive = await call(`/api/purchases/${poId}/receive`, {
      method: "POST",
      headers: json(t.apoteker),
      body: JSON.stringify({}),
    });
    const afterPo = await call(`/api/products/${productId}`, { headers: json(t.kasir) });
    const stockAfter = afterPo.body?.data?.stock;
    c.add(
      "E2E-A06",
      "Pembelian diterima → batch baru & stok bertambah",
      po.status === 201 && receive.status === 200 && Number(stockAfter) === 50,
      `po=${po.status} receive=${receive.status} stok=${stockAfter}`,
    );

    /* -------------------------------------------------------------- A07 */
    const alerts = await call("/api/inventory/alerts", { headers: json(t.apoteker) });
    const expiring = alerts.body?.data?.expiring ?? [];
    const obh = expiring.find((b: any) => b.batchNumber === "OBH-D1");
    const stockList = await call("/api/inventory/stock", { headers: json(t.apoteker) });
    c.add(
      "E2E-A07",
      "Peringatan kedaluwarsa mendeteksi batch OBH-D1 (habis dalam 25 hari)",
      alerts.status === 200 && !!obh && stockList.body?.data?.length > 0,
      `expiring=${expiring.map((b: any) => b.batchNumber).join(",") || "-"}`,
    );

    /* -------------------------------------------------------------- A08 */
    const batchId = afterPo.body?.data?.batches?.[0]?.id as number;
    const adjust = await call("/api/inventory/adjust", {
      method: "POST",
      headers: json(t.apoteker),
      body: JSON.stringify({ batchId, type: "opname", quantity: -2, note: "Uji E2E" }),
    });
    const afterAdjust = await call(`/api/products/${productId}`, {
      headers: json(t.apoteker),
    });
    const movements = await call(`/api/inventory/movements?productId=${productId}`, {
      headers: json(t.apoteker),
    });
    const adjustMovement = (movements.body?.data ?? []).find(
      (m: any) => m.refType === "adjustment" && m.quantity === -2,
    );
    c.add(
      "E2E-A08",
      "Penyesuaian stok (opname −2) tercatat di kartu stok",
      adjust.status === 200 && Number(afterAdjust.body?.data?.stock) === 48 && !!adjustMovement,
      `stok=${afterAdjust.body?.data?.stock} mutasi=${adjustMovement ? "ada" : "tidak ada"}`,
    );
  }

  /* ---------------------------------------------------------------- A09 */
  let shiftId = 0;
  {
    const open = await call("/api/shifts/open", {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({ openingCash: 200000 }),
    });
    shiftId = open.body?.data?.id as number;
    const current = await call("/api/shifts/current", { headers: json(t.kasir) });
    c.add(
      "E2E-A09",
      "Kasir membuka shift dengan uang awal Rp200.000",
      open.status === 201 &&
        current.body?.data?.status === "open" &&
        Number(current.body?.data?.openingCash) === 200000 &&
        Number(current.body?.data?.expectedCash) === 200000,
      `open=${open.status} expectedCash=${current.body?.data?.expectedCash}`,
    );
  }

  /* ---------------------------------------------------------------- A10 */
  {
    const r = await call("/api/sales", {
      method: "POST",
      headers: json(t.apoteker),
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1, unitPrice: 700, discount: 0 }],
        payments: [{ method: "cash", amount: 700 }],
      }),
    });
    c.add(
      "E2E-A10",
      "Transaksi ditolak (409) bila kasir belum membuka shift",
      r.status === 409,
      `status=${r.status} error=${r.body?.error ?? "-"}`,
    );
  }

  /* ------------------------------------------------- A11: FEFO + A12: nota */
  let saleTotal = 0;
  let saleCode = "";
  {
    const found = await call("/api/products/lookup?q=Paracetamol", { headers: json(t.kasir) });
    const paracetamol = (found.body?.data ?? [])[0];
    const pid = paracetamol?.id as number;

    const before = await call(`/api/products/${pid}`, { headers: json(t.kasir) });
    const beforeBatches = before.body?.data?.batches ?? [];
    const a1Before = beforeBatches.find((b: any) => b.batchNumber === "PCM-A1")?.quantity;
    const a2Before = beforeBatches.find((b: any) => b.batchNumber === "PCM-A2")?.quantity;

    const sale = await call("/api/sales", {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({
        items: [{ productId: pid, quantity: 3, unitPrice: 700, discount: 0 }],
        payments: [{ method: "cash", amount: 5000 }],
      }),
    });
    const detail = sale.body?.data;
    saleCode = detail?.code ?? "";
    saleTotal = Number(detail?.total ?? 0);

    const after = await call(`/api/products/${pid}`, { headers: json(t.kasir) });
    const afterBatches = after.body?.data?.batches ?? [];
    const a1After = afterBatches.find((b: any) => b.batchNumber === "PCM-A1")?.quantity;
    const a2After = afterBatches.find((b: any) => b.batchNumber === "PCM-A2")?.quantity;

    c.add(
      "E2E-A11",
      "FEFO: batch kedaluwarsa terdekat (PCM-A2) yang terpakai lebih dulu",
      sale.status === 201 &&
        detail?.items?.[0]?.batchNumber === "PCM-A2" &&
        Number(a2Before) - Number(a2After) === 3 &&
        Number(a1Before) === Number(a1After),
      `batch terpakai=${detail?.items?.[0]?.batchNumber} PCM-A1=${a1Before}→${a1After} PCM-A2=${a2Before}→${a2After}`,
    );

    c.add(
      "E2E-A12",
      "Hitung nota benar: subtotal 2.100, total 2.100, kembalian 2.900",
      r2(Number(detail?.subtotal)) === 2100 &&
        r2(Number(detail?.total)) === 2100 &&
        r2(Number(detail?.changeAmount)) === 2900 &&
        r2(Number(detail?.paidAmount)) === 5000,
      `subtotal=${detail?.subtotal} total=${detail?.total} dibayar=${detail?.paidAmount} kembali=${detail?.changeAmount}`,
    );
  }

  /* ---------------------------------------------------------------- A13 */
  let stripSaleTotal = 0;
  {
    const found = await call("/api/products/lookup?q=Paracetamol", { headers: json(t.kasir) });
    const paracetamol = (found.body?.data ?? [])[0];
    const strip = (paracetamol?.units ?? []).find((u: any) => u.name === "strip");
    const pid = paracetamol?.id as number;

    const before = await call(`/api/products/${pid}`, { headers: json(t.kasir) });
    const stockBefore = Number(before.body?.data?.stock);

    const sale = await call("/api/sales", {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({
        items: [{ productId: pid, unitId: strip?.id, quantity: 1, unitPrice: 6500, discount: 0 }],
        payments: [{ method: "cash", amount: 6500 }],
      }),
    });
    const detail = sale.body?.data;
    stripSaleTotal = Number(detail?.total ?? 0);

    const after = await call(`/api/products/${pid}`, { headers: json(t.kasir) });
    const stockAfter = Number(after.body?.data?.stock);

    c.add(
      "E2E-A13",
      "Jual 1 strip = 10 tablet (konversi satuan) & stok turun 10",
      sale.status === 201 &&
        Number(detail?.items?.[0]?.quantity) === 10 &&
        r2(Number(detail?.total)) === 6500 &&
        stockBefore - stockAfter === 10,
      `items=${detail?.items?.[0]?.quantity} total=${detail?.total} stok ${stockBefore}→${stockAfter}`,
    );
  }

  /* ---------------------------------------------------------------- A14 */
  {
    const r = await call("/api/sales", {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 1, unitPrice: 700, discount: 0 }],
        payments: [{ method: "cash", amount: 100 }],
      }),
    });
    c.add(
      "E2E-A14",
      "Pembayaran kurang dari total ditolak (400)",
      r.status === 400,
      `status=${r.status} error=${r.body?.error ?? "-"}`,
    );
  }

  /* ---------------------------------------------------------------- A15 */
  {
    const before = await call("/api/products/1", { headers: json(t.kasir) });
    const stockBefore = Number(before.body?.data?.stock);
    const r = await call("/api/sales", {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({
        items: [{ productId: 1, quantity: 999999, unitPrice: 700, discount: 0 }],
        payments: [{ method: "cash", amount: 999999 * 700 }],
      }),
    });
    const after = await call("/api/products/1", { headers: json(t.kasir) });
    const stockAfter = Number(after.body?.data?.stock);
    c.add(
      "E2E-A15",
      "Stok tidak mencukupi ditolak & stok tidak berubah (transaksi di-rollback)",
      r.status === 409 && stockBefore === stockAfter,
      `status=${r.status} stok ${stockBefore}→${stockAfter}`,
    );
  }

  /* ---------------------------------------------------------------- A16 */
  let qrisTotal = 0;
  {
    const r = await call("/api/sales", {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({
        items: [{ productId: 3, quantity: 2, unitPrice: 900, discount: 0 }],
        payments: [{ method: "qris", amount: 1800, reference: "QR-E2E" }],
      }),
    });
    qrisTotal = Number(r.body?.data?.total ?? 0);
    c.add(
      "E2E-A16",
      "Pembayaran non-tunai (QRIS) tercatat pada nota",
      r.status === 201 && r.body?.data?.payments?.[0]?.method === "qris",
      `status=${r.status} metode=${r.body?.data?.payments?.[0]?.method}`,
    );
  }

  /* ---------------------------------------------------------------- A17 */
  {
    const r = await call("/api/prescriptions", {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({
        patientName: `Pasien Uji ${stamp}`,
        items: [{ productId: 2, name: "Amoxicillin 500mg", quantity: 15, signa: "3 x 1 sehari" }],
      }),
    });
    const rxId = r.body?.data?.id as number;
    const detail = await call(`/api/prescriptions/${rxId}`, { headers: json(t.apoteker) });
    c.add(
      "E2E-A17",
      "Resep dapat dibuat kasir dan dibaca apoteker (item racikan tersimpan)",
      r.status === 201 &&
        detail.status === 200 &&
        detail.body?.data?.items?.[0]?.signa === "3 x 1 sehari",
      `create=${r.status} detail=${detail.status} signa=${detail.body?.data?.items?.[0]?.signa}`,
    );
  }

  /* ---------------------------------------------------------------- A18 */
  {
    const dash = await call("/api/dashboard/summary", { headers: json(t.owner) });
    const today = dash.body?.data?.today;
    // 4 nota berhasil sejauh ini: Paracetamol (2.100), strip (6.500), QRIS (1.800).
    const expectedRevenue = r2(saleTotal + stripSaleTotal + qrisTotal);
    c.add(
      "E2E-A18",
      "Dashboard mencerminkan penjualan hari ini (3 nota, omzet cocok)",
      dash.status === 200 &&
        Number(today?.transactions) === 3 &&
        r2(Number(today?.revenue)) === expectedRevenue,
      `transaksi=${today?.transactions} omzet=${today?.revenue} (harap=${expectedRevenue})`,
    );
  }

  /* ---------------------------------------------------------------- A19 */
  {
    const current = await call("/api/shifts/current", { headers: json(t.kasir) });
    const data = current.body?.data ?? {};
    const expectedSales = r2(saleTotal + stripSaleTotal + qrisTotal);
    const expectedNonCash = r2(qrisTotal);
    const expectedCash = r2(expectedSales - expectedNonCash);
    const expectedInDrawer = r2(200000 + expectedCash);

    // Kasir menghitung uang fisik lebih Rp5.000 dari seharusnya.
    const close = await call(`/api/shifts/${shiftId}/close`, {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({ closingCash: r2(expectedInDrawer + 5000) }),
    });
    const closed = close.body?.data ?? {};

    c.add(
      "E2E-A19",
      "Rekonsiliasi kas: total, tunai, non-tunai, dan selisih Rp5.000 dihitung tepat",
      current.status === 200 &&
        Number(data.transactionCount) === 3 &&
        r2(Number(data.totalSales)) === expectedSales &&
        r2(Number(data.totalNonCash)) === expectedNonCash &&
        r2(Number(data.expectedCash)) === expectedInDrawer &&
        closed.status === "closed" &&
        r2(Number(closed.difference)) === 5000,
      `transaksi=${data.transactionCount} omzet=${data.totalSales} tunai=${data.totalCash} nonTunai=${data.totalNonCash} expectedCash=${data.expectedCash} selisih=${closed.difference}`,
    );

    // Shift yang sudah ditutup tidak bisa ditutup dua kali.
    const again = await call(`/api/shifts/${shiftId}/close`, {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({ closingCash: 0 }),
    });
    c.add(
      "E2E-A19b",
      "Shift yang sudah ditutup tidak bisa ditutup lagi (409)",
      again.status === 409,
      `status=${again.status}`,
    );
  }

  /* ---------------------------------------------------------------- A20 */
  {
    const file = join(AUDIT_DIR, `audit-${localDate()}.log`);
    let text = "";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      text = "";
    }
    const actions = ["auth.login", "shift.open", "sale.create", "shift.close", "inventory.adjust", "purchase"];
    const found = actions.filter((a) => text.includes(`"action":"${a}"`));
    const leaked = ["password123", "passwordHash", "$argon2"].filter((s) => text.includes(s));
    c.add(
      "E2E-A20",
      "Audit harian merekam seluruh perjalanan & tidak membocorkan rahasia",
      found.length >= 5 && leaked.length === 0,
      `aksi=${found.join(", ")} rahasia=${leaked.length ? leaked.join(",") : "tidak ada"}`,
    );
  }

  /* ---------------------------------------------------------------- A21 */
  {
    const sku = `E2E-C-${stamp}`;
    const created = await call("/api/products", {
      method: "POST",
      headers: json(t.owner),
      body: JSON.stringify({
        sku,
        name: `Produk Rebutan ${stamp}`,
        form: "tablet",
        drugClass: "obat_bebas",
        baseUnit: "tablet",
        salePrice: 2000,
        costPrice: 1000,
        minStock: 0,
        units: [{ name: "tablet", conversion: 1, isBase: true }],
      }),
    });
    const pid = created.body?.data?.id as number;

    const po = await call("/api/purchases", {
      method: "POST",
      headers: json(t.owner),
      body: JSON.stringify({
        supplierId: 1,
        orderDate: localDate(),
        items: [
          {
            productId: pid,
            batchNumber: `E2E-C1-${stamp}`,
            expiryDate: localDate(addDays(new Date(), 180)),
            quantity: 5,
            unitCost: 1000,
          },
        ],
      }),
    });
    await call(`/api/purchases/${po.body?.data?.id}/receive`, {
      method: "POST",
      headers: json(t.owner),
      body: JSON.stringify({}),
    });

    // Shift sebelumnya sudah ditutup di A19 → buka shift baru untuk kasir.
    let shift2 = 0;
    const open2 = await call("/api/shifts/open", {
      method: "POST",
      headers: json(t.kasir),
      body: JSON.stringify({ openingCash: 0 }),
    });
    if (open2.status === 201) {
      shift2 = open2.body?.data?.id as number;
    } else {
      const cur = await call("/api/shifts/current", { headers: json(t.kasir) });
      shift2 = (cur.body?.data?.id as number) ?? 0;
    }

    // 10 kasir menekan tombol bersamaan untuk stok yang hanya 5.
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        call("/api/sales", {
          method: "POST",
          headers: json(t.kasir),
          body: JSON.stringify({
            items: [{ productId: pid, quantity: 1, unitPrice: 2000, discount: 0 }],
            payments: [{ method: "cash", amount: 2000 }],
          }),
        }),
      ),
    );
    const ok = attempts.filter((r) => r.status === 201).length;
    const rejected = attempts.filter((r) => r.status === 409).length;

    const detail = await call(`/api/products/${pid}`, { headers: json(t.owner) });
    const batch = (detail.body?.data?.batches ?? []).find((b: any) =>
      String(b.batchNumber).startsWith("E2E-C1"),
    );
    const rest = Number(batch?.quantity);

    c.add(
      "E2E-A21",
      "10 transaksi serentak memperebutkan stok 5 → tepat 5 sukses, stok berakhir 0",
      ok === 5 && rejected === 5 && rest === 0,
      `sukses=${ok} ditolak=${rejected} sisa stok=${rest}`,
    );

    // Kode nota harus unik.
    const all = await call("/api/sales", { headers: json(t.owner) });
    const codes = (all.body?.data ?? []).map((s: any) => s.code);
    const unique = new Set(codes);
    c.add(
      "E2E-A21b",
      "Semua kode nota unik (tidak ada duplikasi di bawah konkurensi)",
      codes.length > 0 && unique.size === codes.length,
      `total=${codes.length} unik=${unique.size}`,
    );

    // Rapikan: tutup shift sementara supaya uji browser memulai dari kondisi bersih.
    if (shift2) {
      await call(`/api/shifts/${shift2}/close`, {
        method: "POST",
        headers: json(t.kasir),
        body: JSON.stringify({ closingCash: 0 }),
      });
    }
  }

  return c;
}

if (import.meta.main) {
  const checker = await runApiE2E();
  checker.print();
  process.exit(checker.failed.length ? 1 : 0);
}
