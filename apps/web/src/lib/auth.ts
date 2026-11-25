import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt, lt } from "drizzle-orm";
import { sessions, users } from "@pennyats/db";
import { db } from "./db";
import type { Role } from "./permissions";

const COOKIE = "pennyats_session";
const SESSION_DAYS = 30;

export type SessionUser = { id: string; email: string; name: string; role: Role };

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored hashed, so a database leak can't be turned into logged-in sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Mark the cookie Secure when the app is served over https. Self-hosters testing on
// plain http (e.g. `next start` on localhost) would otherwise be unable to sign in.
const secureCookie = (process.env.APP_URL ?? "").startsWith("https://");

export async function startSession(userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db().insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  // Opportunistic cleanup instead of a cron job.
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(COOKIE);
}

/** The signed-in user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ id: users.id, email: users.email, name: users.name, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date())));
  return row ?? null;
});

/**
 * Use at the top of every protected page and server action.
 * Signed out: redirect to /login. Wrong role: 404, so pages don't reveal they exist.
 */
export async function requireUser(check?: (role: Role) => boolean): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (check && !check(user.role)) notFound();
  return user;
}
