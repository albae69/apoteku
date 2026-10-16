import { z } from "zod";
import { money, numeric } from "./common";

export const PRODUCT_FORMS = [
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
] as const;

export const DRUG_CLASSES = [
  "obat_bebas",
  "obat_bebas_terbatas",
  "obat_keras",
  "narkotika",
  "psikotropika",
  "alkes",
  "bhp",
] as const;

export const productUnitInput = z.object({
  id: z.number().int().positive().optional(),
  name: z.string().min(1, "Nama satuan wajib"),
  conversion: numeric.positive("Konversi harus > 0"),
  price: money.optional(),
  barcode: z.string().trim().max(64).optional(),
  isBase: z.boolean().default(false),
});

export const productInput = z.object({
  sku: z.string().trim().min(1, "SKU wajib").max(64),
  barcode: z.string().trim().max(64).optional().or(z.literal("")),
  name: z.string().trim().min(1, "Nama wajib").max(200),
  genericName: z.string().trim().max(200).optional().or(z.literal("")),
  categoryId: z.number().int().positive().nullable().optional(),
  manufacturerId: z.number().int().positive().nullable().optional(),
  form: z.enum(PRODUCT_FORMS).default("tablet"),
  strength: z.string().trim().max(100).optional().or(z.literal("")),
  drugClass: z.enum(DRUG_CLASSES).default("obat_bebas"),
  baseUnit: z.string().trim().min(1).max(32).default("tablet"),
  salePrice: money.default(0),
  costPrice: money.default(0),
  minStock: numeric.min(0).default(0),
  requiresPrescription: z.boolean().default(false),
  isActive: z.boolean().default(true),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  units: z.array(productUnitInput).default([]),
});

export type ProductInput = z.infer<typeof productInput>;
export type ProductUnitInput = z.infer<typeof productUnitInput>;
