import { z } from "zod";
import { qty } from "./common";

export const ADJUSTMENT_TYPES = [
  "adjustment",
  "damage",
  "expired",
  "return_in",
  "return_out",
  "opname",
] as const;

export const adjustmentInput = z.object({
  batchId: z.number().int().positive(),
  /** Positif menambah stok, negatif mengurangi. */
  quantity: z.coerce.number().refine((n) => n !== 0, "Jumlah tidak boleh 0"),
  type: z.enum(ADJUSTMENT_TYPES).default("adjustment"),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export type AdjustmentInput = z.infer<typeof adjustmentInput>;
export { qty };
