import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { db } from "../db";
import { users } from "../db/schema";
import { parse, unauthorized } from "../lib/http";
import { auth, createToken } from "../middleware/auth";
import { setAudit } from "../middleware/audit";
import { clientIp, rateLimit } from "../middleware/rate-limit";

const loginSchema = z.object({
  email: z.string().trim().email("Email tidak valid"),
  password: z.string().min(1, "Password wajib"),
});

/** Anti brute-force: maksimum 20 percobaan gagal per IP dalam 15 menit. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: 20,
  message: "Terlalu banyak percobaan login. Coba lagi nanti.",
});

export const authRoutes = new Hono();

authRoutes.post("/login", async (c) => {
  const key = clientIp(c);
  // Label dasar; outcome & detail dilengkapi di bawah.
  setAudit(c, { event: "auth", action: "auth.login", entity: "user" });
  loginLimiter.take(key);

  const body = await parse(c, loginSchema);
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.email, body.email))
    .limit(1);
  if (!user || !user.isActive) {
    setAudit(c, {
      outcome: "failure",
      detail: { email: body.email, reason: "akun_tidak_ditemukan_atau_nonaktif" },
    });
    throw unauthorized("Email atau password salah");
  }

  const valid = await Bun.password.verify(body.password, user.passwordHash);
  if (!valid) {
    setAudit(c, {
      outcome: "failure",
      entityId: user.id,
      detail: { email: body.email, reason: "password_salah" },
    });
    throw unauthorized("Email atau password salah");
  }

  // Login berhasil tidak dihitung sebagai percobaan gagal.
  loginLimiter.refund(key);

  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
  setAudit(c, {
    outcome: "success",
    entityId: user.id,
    actor: payload,
    detail: { email: user.email, role: user.role },
  });

  const token = await createToken(payload);
  return c.json({ data: { token, user: payload } });
});

authRoutes.get("/me", auth, (c) => c.json({ data: c.get("user") }));
