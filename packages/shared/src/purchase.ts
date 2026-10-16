import { z } from "zod";
import { dateString, money, qty } from "./common";

/* ---------- Master relasi ---------- */

export const supplierInput = z.object({
  name: z.string().trim().min(1, "Nama supplier wajib").max(200),
  contactPerson: z.string().trim().max(120).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email("Email tidak valid").optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  npwp: z.string().trim().max(40).optional().or(z.literal("")),
  isActive: z.boolean().default(true),
});

export const customerInput = z.object({
  name: z.string().trim().min(1, "Nama wajib").max(200),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  email: z.string().trim().email("Email tidak valid").optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
  isMember: z.boolean().default(false),
});

export const doctorInput = z.object({
  name: z.string().trim().min(1, "Nama dokter wajib").max(200),
  sipNumber: z.string().trim().max(60).optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  address: z.string().trim().max(500).optional().or(z.literal("")),
});

export const categoryInput = z.object({
  name: z.string().trim().min(1, "Nama kategori wajib").max(120),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export const manufacturerInput = z.object({
  name: z.string().trim().min(1, "Nama pabrik wajib").max(200),
  country: z.string().trim().max(120).optional().or(z.literal("")),
});

export type SupplierInput = z.infer<typeof supplierInput>;
export type CustomerInput = z.infer<typeof customerInput>;
export type DoctorInput = z.infer<typeof doctorInput>;

/* ---------- Pembelian ---------- */

export const purchaseItemInput = z.object({
  productId: z.number().int().positive(),
  batchNumber: z.string().trim().max(64).optional().or(z.literal("")),
  expiryDate: dateString.optional().nullable(),
  quantity: qty,
  unitCost: money,
});

export const purchaseInput = z.object({
  supplierId: z.number().int().positive(),
  orderDate: dateString,
  note: z.string().trim().max(1000).optional().or(z.literal("")),
  discount: money.default(0),
  tax: money.default(0),
  items: z.array(purchaseItemInput).min(1, "Minimal 1 item"),
});

export const purchaseReceiveInput = z.object({
  receivedDate: dateString.optional(),
});

export type PurchaseInput = z.infer<typeof purchaseInput>;
export type PurchaseItemInput = z.infer<typeof purchaseItemInput>;
