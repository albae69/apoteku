import { z } from "zod";

/** Nilai yang diterima sebagai angka tapi sering datang sebagai string dari form/JSON. */
export const numeric = z.coerce.number();

/** Angka >= 0, dibulatkan 2 desimal (uang). */
export const money = z.coerce
  .number()
  .min(0, "Tidak boleh negatif")
  .transform((n) => Math.round(n * 100) / 100);

export const qty = z.coerce.number().positive("Jumlah harus lebih dari 0");

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(200).default(20),
  q: z.string().trim().optional(),
});

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

export type Pagination = z.infer<typeof pagination>;
export type Paginated<T> = {
  data: T[];
  meta: { page: number; perPage: number; total: number; totalPages: number };
};
