"use server";

import { and, eq, gt } from "drizzle-orm";
import { redirect } from "next/navigation";
import { hashPassword, passwordResets, sessions, users } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { hashToken, startSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { isResetToken, readPassword } from "@/lib/password";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";

const resetLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
const INVALID_LINK = "This reset link is invalid or has expired. Ask an admin for a new one.";

/** Consumes the link and ends every existing session before starting the new one. */
export async function resetPasswordAction(token: string, _: FormState, form: FormData): Promise<FormState> {
  if (!isResetToken(token)) return { error: INVALID_LINK };
  if (!resetLimiter(await clientIp())) return { error: "Too many attempts. Try again later." };

  const parsed = readPassword(form);
  if ("error" in parsed) return parsed;
  const passwordHash = await hashPassword(parsed.password);

  const userId = await db().transaction(async (tx) => {
    const tokenHash = hashToken(token);
    const valid = and(eq(passwordResets.tokenHash, tokenHash), gt(passwordResets.expiresAt, new Date()));
    const [reset] = await tx.select({ userId: passwordResets.userId }).from(passwordResets).where(valid);
    if (!reset) return null;

    // Match link issuance's lock order. A deactivated user cannot use an old link.
    const [user] = await tx.select({ active: users.active }).from(users)
      .where(eq(users.id, reset.userId)).for("update");
    if (!user?.active) return null;

    // Only one concurrent submission can delete this token and update the password.
    const [consumed] = await tx.delete(passwordResets).where(and(
      eq(passwordResets.tokenHash, tokenHash),
      gt(passwordResets.expiresAt, new Date()),
    ))
      .returning({ userId: passwordResets.userId });
    if (!consumed) return null;
    await tx.update(users).set({ passwordHash }).where(eq(users.id, consumed.userId));
    await tx.delete(sessions).where(eq(sessions.userId, consumed.userId));
    return consumed.userId;
  });

  if (!userId) return { error: INVALID_LINK };
  await startSession(userId);
  redirect("/");
}
