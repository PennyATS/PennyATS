"use server";

import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import {
  hashPassword,
  instance,
  invites,
  users,
  verifyPassword,
} from "@pennyats/db";
import type { FormState } from "@/components/form";
import { endSession, hashToken, startSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { createRateLimiter } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { readPassword } from "@/lib/password";
import { field, isEmail, normalizeEmail } from "@/lib/validation";

const loginLimiter = createRateLimiter({ limit: 10, windowMs: 15 * 60 * 1000 });

/** First-run setup: creates the first admin. Only works once. */
export async function setupAction(_: FormState, form: FormData): Promise<FormState> {
  const name = field(form, "name", 200);
  const email = normalizeEmail(field(form, "email", 254) ?? "");
  if (!name) return { error: "Name is required." };
  if (!isEmail(email)) return { error: "Enter a valid email address." };
  const pw = readPassword(form);
  if ("error" in pw) return pw;
  const passwordHash = await hashPassword(pw.password);

  const userId = await db().transaction(async (tx) => {
    // Claim the setup slot atomically, so two people racing to set up can't both become admin.
    const claimed = await tx
      .insert(instance)
      .values({ id: true, setupComplete: true })
      .onConflictDoUpdate({
        target: instance.id,
        set: { setupComplete: true },
        setWhere: eq(instance.setupComplete, false),
      })
      .returning();
    if (claimed.length === 0) return null;
    const [user] = await tx
      .insert(users)
      .values({ name, email, passwordHash, role: "admin" })
      .returning({ id: users.id });
    return user.id;
  });

  if (!userId) redirect("/login");
  await startSession(userId);
  redirect("/");
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = normalizeEmail(field(form, "email", 254) ?? "");
  const password = form.get("password");
  if (!email || typeof password !== "string" || !password) {
    return { error: "Enter your email and password." };
  }
  if (!loginLimiter(`${await clientIp()}:${email}`)) {
    return { error: "Too many attempts. Try again in 15 minutes." };
  }

  const [user] = await db().select().from(users).where(eq(users.email, email));
  // Verify even when the user doesn't exist, so response time doesn't reveal which emails have accounts.
  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.active || !ok) return { error: "Email or password is incorrect." };

  await startSession(user.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect("/login");
}

export async function acceptInviteAction(
  token: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const name = field(form, "name", 200);
  if (!name) return { error: "Name is required." };
  const pw = readPassword(form);
  if ("error" in pw) return pw;
  const passwordHash = await hashPassword(pw.password);

  const result = await db()
    .transaction(async (tx) => {
      // Mark the invite used in the same statement that checks it, so a link works exactly once.
      const [invite] = await tx
        .update(invites)
        .set({ acceptedAt: sql`now()` })
        .where(
          and(
            eq(invites.tokenHash, hashToken(token)),
            isNull(invites.acceptedAt),
            gt(invites.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!invite) return { error: "This invite link is invalid or has expired." } as const;

      const [user] = await tx
        .insert(users)
        .values({ name, email: invite.email, passwordHash, role: invite.role })
        .onConflictDoNothing()
        .returning({ id: users.id });
      // Roll back so the invite stays unused if the account already exists.
      if (!user) throw new AccountExists();
      return { userId: user.id } as const;
    })
    .catch((err: unknown) => {
      if (err instanceof AccountExists) {
        return { error: "An account with this email already exists. Sign in instead." } as const;
      }
      throw err;
    });

  if ("error" in result) return { error: result.error };
  await startSession(result.userId);
  redirect("/");
}

class AccountExists extends Error {}

// Well-formed hash that never matches, used to keep login timing uniform.
const DUMMY_HASH =
  "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");
