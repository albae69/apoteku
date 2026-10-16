import { z } from "zod";
import { money, qty } from "./common";

export const PAYMENT_METHODS = [
  "cash",
  "debit",
  "credit",
  "qris",
  "ewallet",
  "transfer",
] as const;

export const saleItemInput = z.object({
  productId: z.number().int().positive(),
  /** Satuan jual yang dipilih (id dari product_units, atau null = satuan dasar). */
  unitId: z.number().int().positive().nullable().optional(),
  /** Jumlah dalam satuan jual (akan dikonversi ke satuan dasar). */
  quantity: qty,
  unitPrice: money,
  discount: money.default(0),
});

export const salePaymentInput = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: money,
  reference: z.string().trim().max(120).optional().or(z.literal("")),
});

export const saleInput = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  prescriptionId: z.number().int().positive().nullable().optional(),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
  discount: money.default(0),
  tax: money.default(0),
  items: z.array(saleItemInput).min(1, "Keranjang kosong"),
  payments: z.array(salePaymentInput).min(1, "Minimal 1 pembayaran"),
});

export type SaleInput = z.infer<typeof saleInput>;
export type SaleItemInput = z.infer<typeof saleItemInput>;

/** Hasil alokasi FEFO per item (dipakai API internal & ditampilkan di UI). */
export type FefoAllocation = {
  batchId: number;
  batchNumber: string | null;
  expiryDate: string | null;
  quantity: number;
  costPrice: number;
};
