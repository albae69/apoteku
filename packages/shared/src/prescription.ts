import { z } from "zod";
import { qty } from "./common";

export const prescriptionItemInput = z.object({
  productId: z.number().int().positive().nullable().optional(),
  /** Nama obat kalau belum terdaftar di master (mis. racikan). */
  name: z.string().trim().max(200).optional().or(z.literal("")),
  quantity: qty,
  signa: z.string().trim().max(200).optional().or(z.literal("")),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export const prescriptionInput = z.object({
  customerId: z.number().int().positive().nullable().optional(),
  doctorId: z.number().int().positive().nullable().optional(),
  patientName: z.string().trim().min(1, "Nama pasien wajib").max(200),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
  items: z.array(prescriptionItemInput).min(1, "Minimal 1 item resep"),
});

export type PrescriptionInput = z.infer<typeof prescriptionInput>;
export type PrescriptionItemInput = z.infer<typeof prescriptionItemInput>;
