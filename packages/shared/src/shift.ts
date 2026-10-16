import { z } from "zod";
import { money } from "./common";

export const openShiftInput = z.object({
  openingCash: money.default(0),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export const closeShiftInput = z.object({
  /** Uang tunai fisik yang dihitung kasir saat tutup shift. */
  closingCash: money,
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export type OpenShiftInput = z.infer<typeof openShiftInput>;
export type CloseShiftInput = z.infer<typeof closeShiftInput>;
