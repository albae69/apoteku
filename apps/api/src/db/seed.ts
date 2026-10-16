import { sql } from "drizzle-orm";
import {
  batches,
  categories,
  customers,
  doctors,
  manufacturers,
  prescriptions,
  products,
  productUnits,
  purchaseItems,
  purchases,
  prescriptionItems,
  settings,
  stockMovements,
  suppliers,
  users,
} from "./schema";
import { db, pool } from "./index";
import { addDays, localDate } from "../lib/code";

async function reset() {
  // TRUNCATE agar AUTO_INCREMENT ikut ter-reset (id selalu mulai dari 1).
  const tables = [
    "payments",
    "sale_items",
    "sales",
    "stock_movements",
    "batches",
    "purchase_items",
    "purchases",
    "prescription_items",
    "prescriptions",
    "product_units",
    "products",
    "categories",
    "manufacturers",
    "suppliers",
    "customers",
    "doctors",
    "shifts",
    "users",
    "settings",
  ];
  await db.execute(sql`set foreign_key_checks = 0`);
  for (const table of tables) {
    await db.execute(sql.raw(`truncate table \`${table}\``));
  }
  await db.execute(sql`set foreign_key_checks = 1`);
}

async function main() {
  console.log("Reset data lama...");
  await reset();

  console.log("Seed settings & users...");
  await db.insert(settings).values({
    pharmacyName: "Apoteku Sehat",
    address: "Jl. Melati No. 12, Jakarta",
    phone: "021-1234567",
    pharmacistName: "Apt. Rina Sari",
    sipaNumber: "SIPA-12345",
    taxPercent: 0,
    receiptFooter: "Terima kasih, semoga lekas sembuh!",
  });

  const passwordHash = await Bun.password.hash("password123");
  await db.insert(users).values([
    { name: "Budi Owner", email: "owner@apoteku.test", passwordHash, role: "owner" },
    { name: "Sari Kasir", email: "kasir@apoteku.test", passwordHash, role: "cashier" },
    { name: "Apt. Rina", email: "apoteker@apoteku.test", passwordHash, role: "pharmacist" },
  ]);

  console.log("Seed master data...");
  const catRows = await db.insert(categories).values([
    { name: "Analgesik" },
    { name: "Antibiotik" },
    { name: "Vitamin & Suplemen" },
    { name: "Batuk & Flu" },
    { name: "Alat Kesehatan" },
  ]);
  const catId = (i: number) => Number(catRows[0].insertId) + i;

  const manRows = await db.insert(manufacturers).values([
    { name: "Kimia Farma", country: "Indonesia" },
    { name: "Kalbe Farma", country: "Indonesia" },
    { name: "Sanbe Farma", country: "Indonesia" },
    { name: "Dexa Medica", country: "Indonesia" },
  ]);
  const manId = (i: number) => Number(manRows[0].insertId) + i;

  const supRows = await db.insert(suppliers).values([
    {
      name: "PT Kimia Farma Trading",
      contactPerson: "Andi",
      phone: "021-555111",
      email: "sales@kftrading.test",
      address: "Jakarta",
    },
    {
      name: "PT Enseval Putera",
      contactPerson: "Dewi",
      phone: "021-555222",
      email: "order@enseval.test",
      address: "Jakarta",
    },
  ]);
  const supId = (i: number) => Number(supRows[0].insertId) + i;

  await db.insert(customers).values([
    { name: "Umum", isMember: false },
    { name: "Ibu Ani", phone: "0812-1111-2222", isMember: true, points: 120 },
    { name: "Bapak Joko", phone: "0813-3333-4444", isMember: true },
  ]);

  await db.insert(doctors).values([
    { name: "dr. Andi Wijaya", sipNumber: "SIP-001" },
    { name: "dr. Maya Putri, Sp.A", sipNumber: "SIP-002" },
  ]);

  console.log("Seed produk...");
  type ProductSeed = {
    sku: string;
    barcode: string;
    name: string;
    genericName?: string;
    categoryIndex: number;
    manufacturerIndex: number;
    form: "tablet" | "kapsul" | "sirup" | "lainnya" | "tetes";
    strength?: string;
    drugClass:
      | "obat_bebas"
      | "obat_bebas_terbatas"
      | "obat_keras"
      | "alkes";
    baseUnit: string;
    salePrice: number;
    costPrice: number;
    minStock: number;
    requiresPrescription: boolean;
    units: { name: string; conversion: number; price?: number; isBase?: boolean }[];
  };

  const productSeeds: ProductSeed[] = [
    {
      sku: "OBT-0001",
      barcode: "8991234000011",
      name: "Paracetamol 500mg",
      genericName: "Paracetamol",
      categoryIndex: 0,
      manufacturerIndex: 0,
      form: "tablet",
      strength: "500mg",
      drugClass: "obat_bebas",
      baseUnit: "tablet",
      salePrice: 700,
      costPrice: 350,
      minStock: 100,
      requiresPrescription: false,
      units: [
        { name: "tablet", conversion: 1, isBase: true },
        { name: "strip", conversion: 10, price: 6500 },
        { name: "box", conversion: 100, price: 60000 },
      ],
    },
    {
      sku: "OBT-0002",
      barcode: "8991234000028",
      name: "Amoxicillin 500mg",
      genericName: "Amoxicillin",
      categoryIndex: 1,
      manufacturerIndex: 3,
      form: "kapsul",
      strength: "500mg",
      drugClass: "obat_keras",
      baseUnit: "kapsul",
      salePrice: 1500,
      costPrice: 800,
      minStock: 50,
      requiresPrescription: true,
      units: [
        { name: "kapsul", conversion: 1, isBase: true },
        { name: "strip", conversion: 10, price: 14000 },
      ],
    },
    {
      sku: "OBT-0003",
      barcode: "8991234000035",
      name: "Vitamin C 500mg",
      genericName: "Ascorbic Acid",
      categoryIndex: 2,
      manufacturerIndex: 1,
      form: "tablet",
      strength: "500mg",
      drugClass: "obat_bebas",
      baseUnit: "tablet",
      salePrice: 900,
      costPrice: 450,
      minStock: 60,
      requiresPrescription: false,
      units: [
        { name: "tablet", conversion: 1, isBase: true },
        { name: "tube", conversion: 30, price: 25000 },
      ],
    },
    {
      sku: "OBT-0004",
      barcode: "8991234000042",
      name: "OBH Combi Batuk Flu 60ml",
      categoryIndex: 3,
      manufacturerIndex: 2,
      form: "sirup",
      strength: "60ml",
      drugClass: "obat_bebas_terbatas",
      baseUnit: "botol",
      salePrice: 18000,
      costPrice: 12000,
      minStock: 12,
      requiresPrescription: false,
      units: [{ name: "botol", conversion: 1, isBase: true }],
    },
    {
      sku: "ALK-0001",
      barcode: "8991234000059",
      name: "Termometer Digital",
      categoryIndex: 4,
      manufacturerIndex: 2,
      form: "lainnya",
      drugClass: "alkes",
      baseUnit: "pcs",
      salePrice: 45000,
      costPrice: 30000,
      minStock: 5,
      requiresPrescription: false,
      units: [{ name: "pcs", conversion: 1, isBase: true }],
    },
  ];

  for (const p of productSeeds) {
    const res = await db.insert(products).values({
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      genericName: p.genericName,
      categoryId: catId(p.categoryIndex),
      manufacturerId: manId(p.manufacturerIndex),
      form: p.form,
      strength: p.strength,
      drugClass: p.drugClass,
      baseUnit: p.baseUnit,
      salePrice: p.salePrice,
      costPrice: p.costPrice,
      minStock: p.minStock,
      requiresPrescription: p.requiresPrescription,
    });
    const productId = Number(res[0].insertId);
    await db.insert(productUnits).values(
      p.units.map((u) => ({
        productId,
        name: u.name,
        conversion: u.conversion,
        price: u.price ?? null,
        isBase: u.isBase ?? false,
      })),
    );
  }

  console.log("Seed batch stok awal...");
  // Ambil id produk yang baru dibuat (urut sesuai seed).
  const allProducts = await db.select({ id: products.id, sku: products.sku }).from(products);
  const productBySku = new Map(allProducts.map((p) => [p.sku, p.id]));

  const batchSeeds = [
    { sku: "OBT-0001", batchNumber: "PCM-A1", expiryInDays: 400, quantity: 500, cost: 350 },
    { sku: "OBT-0001", batchNumber: "PCM-A2", expiryInDays: 60, quantity: 120, cost: 360 },
    { sku: "OBT-0002", batchNumber: "AMX-B1", expiryInDays: 300, quantity: 200, cost: 800 },
    { sku: "OBT-0003", batchNumber: "VTC-C1", expiryInDays: 500, quantity: 300, cost: 450 },
    { sku: "OBT-0004", batchNumber: "OBH-D1", expiryInDays: 25, quantity: 24, cost: 12000 },
    { sku: "ALK-0001", batchNumber: "THM-E1", expiryInDays: 900, quantity: 10, cost: 30000 },
  ];

  for (const b of batchSeeds) {
    const productId = productBySku.get(b.sku);
    if (!productId) continue;
    const res = await db.insert(batches).values({
      productId,
      supplierId: supId(0),
      batchNumber: b.batchNumber,
      expiryDate: localDate(addDays(new Date(), b.expiryInDays)),
      quantity: b.quantity,
      costPrice: b.cost,
    });
    await db.insert(stockMovements).values({
      productId,
      batchId: Number(res[0].insertId),
      type: "purchase_in",
      quantity: b.quantity,
      costPrice: b.cost,
      refType: "seed",
      note: "Stok awal seed",
    });
  }

  console.log("Seed pembelian contoh...");
  const paracetamolId = productBySku.get("OBT-0001")!;
  const purchaseRes = await db.insert(purchases).values({
    code: `PO-${localDate().replace(/-/g, "")}-0001`,
    supplierId: supId(0),
    status: "received",
    orderDate: localDate(),
    receivedDate: localDate(),
    subtotal: 35000,
    discount: 0,
    tax: 0,
    total: 35000,
    paidAmount: 35000,
    note: "Seed",
  });
  const purchaseId = Number(purchaseRes[0].insertId);
  await db.insert(purchaseItems).values({
    purchaseId,
    productId: paracetamolId,
    batchNumber: "PCM-A1",
    expiryDate: localDate(addDays(new Date(), 400)),
    quantity: 100,
    unitCost: 350,
    subtotal: 35000,
  });

  console.log("Seed resep contoh...");
  const doctorsRows = await db.select({ id: doctors.id }).from(doctors).limit(1);
  const rxRes = await db.insert(prescriptions).values({
    code: `RSP-${localDate().replace(/-/g, "")}-0001`,
    doctorId: doctorsRows[0]?.id ?? null,
    patientName: "Tn. Contoh",
    status: "pending",
    note: "Resep contoh",
  });
  const prescriptionId = Number(rxRes[0].insertId);
  await db.insert(prescriptionItems).values({
    prescriptionId,
    productId: productBySku.get("OBT-0002")!,
    name: "Amoxicillin 500mg",
    quantity: 15,
    signa: "3 x 1 sehari",
  });

  console.log("Selesai. Login: owner@apoteku.test / password123");
  await pool.end();
  process.exit(0);
}

await main();
