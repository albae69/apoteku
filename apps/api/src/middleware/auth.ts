import { sign, verify } from "hono/jwt";
import type { Context, Next } from "hono";
import type { UserRole } from "@apoteku/shared";
import { env } from "../env";
import { forbidden, unauthorized } from "../lib/http";

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  role: UserRole;
};

declare module "hono" {
  interface ContextVariableMap {
    user: AuthUser;
  }
}

const TOKEN_TTL_SECONDS = 60 * 60 * 12; // 12 jam

export async function createToken(user: AuthUser): Promise<string> {
  return sign(
    {
      sub: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
    },
    env.jwtSecret,
    "HS256",
  );
}

export async function auth(c: Context, next: Next) {
  const header = c.req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw unauthorized();
  try {
    const payload = await verify(token, env.jwtSecret, "HS256");
    c.set("user", {
      id: Number(payload.sub),
      name: String(payload.name ?? ""),
      email: String(payload.email ?? ""),
      role: payload.role as UserRole,
    });
  } catch {
    throw unauthorized("Token tidak valid atau kedaluwarsa");
  }
  await next();
}

/** Batasi endpoint ke role tertentu. */
export const requireRole =
  (...roles: UserRole[]) =>
  async (c: Context, next: Next) => {
    const user = c.get("user");
    if (!user || !roles.includes(user.role)) throw forbidden();
    await next();
  };
