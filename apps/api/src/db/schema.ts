import { relations } from "drizzle-orm";
import {
  boolean,
  date,
  decimal,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

const money = (name: string) =>
  decimal(name, { precision: 14, scale: 2, mode: "number" });

const qty = (name: string) =>
  decimal(name, { precision: 14, scale: 3, mode: "number" });

const timestamps = {
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
};

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  email: varchar("email", { length: 190 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  role: mysqlEnum("role", ["owner", "admin", "pharmacist", "cashier"])
    .notNull()
    .default("cashier"),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

/* ------------------------------------------------------------------ */
/* Shift kasir                                                         */
/* ------------------------------------------------------------------ */

export const shifts = mysqlTable(
  "shifts",
  {
    id: int("id").autoincrement().primaryKey(),
    userId: int("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: mysqlEnum("status", ["open", "closed"]).notNull().default("open"),
    openedAt: timestamp("opened_at").notNull().defaultNow(),
    closedAt: timestamp("closed_at"),
    /** Uang laci saat buka shift. */
    openingCash: money("opening_cash").notNull().default(0),
    /** Hasil hitung fisik saat tutup shift. */
    closingCash: money("closing_cash"),
    /** openingCash + penjualan tunai; diisi saat tutup. */
    expectedCash: money("expected_cash"),
    /** closingCash - expectedCash (positif = lebih, negatif = kurang). */
    difference: money("difference"),
    totalSales: money("total_sales").notNull().default(0),
    totalCash: money("total_cash").notNull().default(0),
    totalNonCash: money("total_non_cash").notNull().default(0),
    transactionCount: int("transaction_count").notNull().default(0),
    note: varchar("note", { length: 500 }),
    ...timestamps,
  },
  (t) => [
    index("shifts_user_idx").on(t.userId),
    index("shifts_status_idx").on(t.status),
  ],
);

/* ------------------------------------------------------------------ */
/* Master data                                                         */
/* ------------------------------------------------------------------ */

export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  pharmacyName: varchar("pharmacy_name", { length: 200 })
    .notNull()
    .default("Apoteku"),
  address: text("address"),
  phone: varchar("phone", { length: 40 }),
  npwp: varchar("npwp", { length: 40 }),
  pharmacistName: varchar("pharmacist_name", { length: 200 }),
  sipaNumber: varchar("sipa_number", { length: 60 }),
  taxPercent: decimal("tax_percent", { precision: 5, scale: 2, mode: "number" })
    .notNull()
    .default(0),
  receiptFooter: text("receipt_footer"),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export const categories = mysqlTable("categories", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 120 }).notNull(),
  description: varchar("description", { length: 500 }),
  ...timestamps,
});

export const manufacturers = mysqlTable("manufacturers", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  country: varchar("country", { length: 120 }),
  ...timestamps,
});

export const suppliers = mysqlTable(
  "suppliers",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    contactPerson: varchar("contact_person", { length: 120 }),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 190 }),
    address: varchar("address", { length: 500 }),
    npwp: varchar("npwp", { length: 40 }),
    isActive: boolean("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [index("suppliers_name_idx").on(t.name)],
);

export const customers = mysqlTable(
  "customers",
  {
    id: int("id").autoincrement().primaryKey(),
    name: varchar("name", { length: 200 }).notNull(),
    phone: varchar("phone", { length: 40 }),
    email: varchar("email", { length: 190 }),
    address: varchar("address", { length: 500 }),
    isMember: boolean("is_member").notNull().default(false),
    points: int("points").notNull().default(0),
    ...timestamps,
  },
  (t) => [index("customers_name_idx").on(t.name)],
);

export const doctors = mysqlTable("doctors", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  sipNumber: varchar("sip_number", { length: 60 }),
  phone: varchar("phone", { length: 40 }),
  address: varchar("address", { length: 500 }),
  ...timestamps,
});

/* ------------------------------------------------------------------ */
/* Produk & satuan                                                     */
/* ------------------------------------------------------------------ */

export const products = mysqlTable(
  "products",
  {
    id: int("id").autoincrement().primaryKey(),
    sku: varchar("sku", { length: 64 }).notNull().unique(),
    barcode: varchar("barcode", { length: 64 }),
    name: varchar("name", { length: 200 }).notNull(),
    genericName: varchar("generic_name", { length: 200 }),
    categoryId: int("category_id").references(() => categories.id, {
      onDelete: "set null",
    }),
    manufacturerId: int("manufacturer_id").references(() => manufacturers.id, {
      onDelete: "set null",
    }),
    form: mysqlEnum("form", [
      "tablet",
      "kapsul",
      "sirup",
      "salep",
      "krim",
      "gel",
      "tetes",
      "injeksi",
      "suppositoria",
      "serbuk",
      "lainnya",
    ])
      .notNull()
      .default("tablet"),
    strength: varchar("strength", { length: 100 }),
    drugClass: mysqlEnum("drug_class", [
      "obat_bebas",
      "obat_bebas_terbatas",
      "obat_keras",
      "narkotika",
      "psikotropika",
      "alkes",
      "bhp",
    ])
      .notNull()
      .default("obat_bebas"),
    /** Satuan dasar / terkecil (tablet, ml, pcs). */
    baseUnit: varchar("base_unit", { length: 32 }).notNull().default("tablet"),
    /** Harga jual per satuan dasar. */
    salePrice: money("sale_price").notNull().default(0),
    /** Harga pokok default per satuan dasar (dipakai bila batch belum ada). */
    costPrice: money("cost_price").notNull().default(0),
    minStock: qty("min_stock").notNull().default(0),
    requiresPrescription: boolean("requires_prescription")
      .notNull()
      .default(false),
    isActive: boolean("is_active").notNull().default(true),
    description: text("description"),
    ...timestamps,
  },
  (t) => [
    index("products_name_idx").on(t.name),
    index("products_barcode_idx").on(t.barcode),
  ],
);

export const productUnits = mysqlTable(
  "product_units",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 32 }).notNull(),
    /** isi satuan ini dalam satuan dasar (1 strip = 10 tablet -> 10). */
    conversion: qty("conversion").notNull().default(1),
    /** harga jual per satuan ini; null = pakai salePrice produk * conversion. */
    price: money("price"),
    barcode: varchar("barcode", { length: 64 }),
    isBase: boolean("is_base").notNull().default(false),
    ...timestamps,
  },
  (t) => [index("product_units_product_idx").on(t.productId)],
);

/* ------------------------------------------------------------------ */
/* Inventory                                                           */
/* ------------------------------------------------------------------ */

export const batches = mysqlTable(
  "batches",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    supplierId: int("supplier_id").references(() => suppliers.id, {
      onDelete: "set null",
    }),
    batchNumber: varchar("batch_number", { length: 64 }),
    expiryDate: date("expiry_date", { mode: "string" }),
    /** Sisa stok dalam satuan dasar. */
    quantity: qty("quantity").notNull().default(0),
    costPrice: money("cost_price").notNull().default(0),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [
    index("batches_product_idx").on(t.productId),
    index("batches_expiry_idx").on(t.expiryDate),
  ],
);

export const stockMovements = mysqlTable(
  "stock_movements",
  {
    id: int("id").autoincrement().primaryKey(),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    batchId: int("batch_id").references(() => batches.id, {
      onDelete: "set null",
    }),
    type: mysqlEnum("type", [
      "purchase_in",
      "sale_out",
      "adjustment",
      "damage",
      "expired",
      "return_in",
      "return_out",
      "opname",
    ]).notNull(),
    /** Positif = masuk, negatif = keluar (dalam satuan dasar). */
    quantity: qty("quantity").notNull(),
    /** Harga pokok per unit pada saat mutasi (untuk HPP penjualan). */
    costPrice: money("cost_price").notNull().default(0),
    refType: varchar("ref_type", { length: 32 }),
    refId: int("ref_id"),
    note: varchar("note", { length: 500 }),
    userId: int("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("stock_movements_product_idx").on(t.productId),
    index("stock_movements_created_idx").on(t.createdAt),
  ],
);

/* ------------------------------------------------------------------ */
/* Pembelian                                                           */
/* ------------------------------------------------------------------ */

export const purchases = mysqlTable(
  "purchases",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    supplierId: int("supplier_id")
      .notNull()
      .references(() => suppliers.id, { onDelete: "restrict" }),
    status: mysqlEnum("status", ["draft", "ordered", "received", "cancelled"])
      .notNull()
      .default("draft"),
    orderDate: date("order_date", { mode: "string" }).notNull(),
    receivedDate: date("received_date", { mode: "string" }),
    subtotal: money("subtotal").notNull().default(0),
    discount: money("discount").notNull().default(0),
    tax: money("tax").notNull().default(0),
    total: money("total").notNull().default(0),
    paidAmount: money("paid_amount").notNull().default(0),
    note: text("note"),
    userId: int("user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("purchases_supplier_idx").on(t.supplierId)],
);

export const purchaseItems = mysqlTable(
  "purchase_items",
  {
    id: int("id").autoincrement().primaryKey(),
    purchaseId: int("purchase_id")
      .notNull()
      .references(() => purchases.id, { onDelete: "cascade" }),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    batchNumber: varchar("batch_number", { length: 64 }),
    expiryDate: date("expiry_date", { mode: "string" }),
    /** Jumlah dalam satuan dasar. */
    quantity: qty("quantity").notNull(),
    unitCost: money("unit_cost").notNull().default(0),
    subtotal: money("subtotal").notNull().default(0),
  },
  (t) => [index("purchase_items_purchase_idx").on(t.purchaseId)],
);

/* ------------------------------------------------------------------ */
/* Penjualan                                                           */
/* ------------------------------------------------------------------ */

export const sales = mysqlTable(
  "sales",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    customerId: int("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    prescriptionId: int("prescription_id"),
    shiftId: int("shift_id").references(() => shifts.id, {
      onDelete: "set null",
    }),
    status: mysqlEnum("status", ["completed", "void"])
      .notNull()
      .default("completed"),
    subtotal: money("subtotal").notNull().default(0),
    discount: money("discount").notNull().default(0),
    tax: money("tax").notNull().default(0),
    total: money("total").notNull().default(0),
    paidAmount: money("paid_amount").notNull().default(0),
    changeAmount: money("change_amount").notNull().default(0),
    /** Total HPP dari item terjual (untuk laporan margin). */
    costTotal: money("cost_total").notNull().default(0),
    note: text("note"),
    userId: int("user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("sales_created_idx").on(t.createdAt),
    index("sales_customer_idx").on(t.customerId),
  ],
);

export const saleItems = mysqlTable(
  "sale_items",
  {
    id: int("id").autoincrement().primaryKey(),
    saleId: int("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    productId: int("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "restrict" }),
    batchId: int("batch_id").references(() => batches.id, {
      onDelete: "set null",
    }),
    /** Jumlah dalam satuan dasar. */
    quantity: qty("quantity").notNull(),
    unitPrice: money("unit_price").notNull().default(0),
    costPrice: money("cost_price").notNull().default(0),
    discount: money("discount").notNull().default(0),
    subtotal: money("subtotal").notNull().default(0),
  },
  (t) => [index("sale_items_sale_idx").on(t.saleId)],
);

export const payments = mysqlTable(
  "payments",
  {
    id: int("id").autoincrement().primaryKey(),
    saleId: int("sale_id")
      .notNull()
      .references(() => sales.id, { onDelete: "cascade" }),
    method: mysqlEnum("method", [
      "cash",
      "debit",
      "credit",
      "qris",
      "ewallet",
      "transfer",
    ])
      .notNull()
      .default("cash"),
    amount: money("amount").notNull(),
    reference: varchar("reference", { length: 120 }),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("payments_sale_idx").on(t.saleId)],
);

/* ------------------------------------------------------------------ */
/* Resep                                                               */
/* ------------------------------------------------------------------ */

export const prescriptions = mysqlTable(
  "prescriptions",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 40 }).notNull().unique(),
    customerId: int("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    doctorId: int("doctor_id").references(() => doctors.id, {
      onDelete: "set null",
    }),
    patientName: varchar("patient_name", { length: 200 }).notNull(),
    status: mysqlEnum("status", ["pending", "dispensed", "cancelled"])
      .notNull()
      .default("pending"),
    note: text("note"),
    userId: int("user_id").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("prescriptions_patient_idx").on(t.patientName)],
);

export const prescriptionItems = mysqlTable(
  "prescription_items",
  {
    id: int("id").autoincrement().primaryKey(),
    prescriptionId: int("prescription_id")
      .notNull()
      .references(() => prescriptions.id, { onDelete: "cascade" }),
    productId: int("product_id").references(() => products.id, {
      onDelete: "set null",
    }),
    name: varchar("name", { length: 200 }).notNull(),
    quantity: qty("quantity").notNull().default(1),
    signa: varchar("signa", { length: 200 }),
    note: varchar("note", { length: 500 }),
  },
  (t) => [index("prescription_items_prescription_idx").on(t.prescriptionId)],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ many }) => ({
  sales: many(sales),
  shifts: many(shifts),
}));

export const shiftsRelations = relations(shifts, ({ one, many }) => ({
  user: one(users, { fields: [shifts.userId], references: [users.id] }),
  sales: many(sales),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  manufacturer: one(manufacturers, {
    fields: [products.manufacturerId],
    references: [manufacturers.id],
  }),
  units: many(productUnits),
  batches: many(batches),
}));

export const productUnitsRelations = relations(productUnits, ({ one }) => ({
  product: one(products, {
    fields: [productUnits.productId],
    references: [products.id],
  }),
}));

export const batchesRelations = relations(batches, ({ one }) => ({
  product: one(products, {
    fields: [batches.productId],
    references: [products.id],
  }),
  supplier: one(suppliers, {
    fields: [batches.supplierId],
    references: [suppliers.id],
  }),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, {
    fields: [stockMovements.productId],
    references: [products.id],
  }),
  batch: one(batches, {
    fields: [stockMovements.batchId],
    references: [batches.id],
  }),
}));

export const purchasesRelations = relations(purchases, ({ one, many }) => ({
  supplier: one(suppliers, {
    fields: [purchases.supplierId],
    references: [suppliers.id],
  }),
  items: many(purchaseItems),
}));

export const purchaseItemsRelations = relations(purchaseItems, ({ one }) => ({
  purchase: one(purchases, {
    fields: [purchaseItems.purchaseId],
    references: [purchases.id],
  }),
  product: one(products, {
    fields: [purchaseItems.productId],
    references: [products.id],
  }),
}));

export const salesRelations = relations(sales, ({ one, many }) => ({
  customer: one(customers, {
    fields: [sales.customerId],
    references: [customers.id],
  }),
  user: one(users, { fields: [sales.userId], references: [users.id] }),
  shift: one(shifts, { fields: [sales.shiftId], references: [shifts.id] }),
  items: many(saleItems),
  payments: many(payments),
}));

export const saleItemsRelations = relations(saleItems, ({ one }) => ({
  sale: one(sales, { fields: [saleItems.saleId], references: [sales.id] }),
  product: one(products, {
    fields: [saleItems.productId],
    references: [products.id],
  }),
  batch: one(batches, {
    fields: [saleItems.batchId],
    references: [batches.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  sale: one(sales, { fields: [payments.saleId], references: [sales.id] }),
}));

export const prescriptionsRelations = relations(
  prescriptions,
  ({ one, many }) => ({
    customer: one(customers, {
      fields: [prescriptions.customerId],
      references: [customers.id],
    }),
    doctor: one(doctors, {
      fields: [prescriptions.doctorId],
      references: [doctors.id],
    }),
    items: many(prescriptionItems),
  }),
);

export const prescriptionItemsRelations = relations(
  prescriptionItems,
  ({ one }) => ({
    prescription: one(prescriptions, {
      fields: [prescriptionItems.prescriptionId],
      references: [prescriptions.id],
    }),
    product: one(products, {
      fields: [prescriptionItems.productId],
      references: [products.id],
    }),
  }),
);
