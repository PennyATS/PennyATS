"use server";

import { and, count, eq, isNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { invites, passwordResets, sessions, users } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { hashToken, newToken, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEMO_BLOCKED, isDemoMode } from "@/lib/demo";
import { canManageUsers, isRole, removesLastAdmin } from "@/lib/permissions";
import { sendSmtp, smtpConfigured } from "@/lib/smtp";
import { field, isEmail, isUuid, normalizeEmail } from "@/lib/validation";

const INVITE_DAYS = 7;
const RESET_HOURS = 24;

/** Creates an invite, emailing it when SMTP is available and returning a manual fallback. */
export async function createInviteAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireUser(canManageUsers);
  // Demo visitors share accounts, so nobody may lock the others out or add real people.
  if (isDemoMode()) return { error: DEMO_BLOCKED };
  const email = normalizeEmail(field(form, "email", 254) ?? "");
  const role = form.get("role");
  if (!isEmail(email)) return { error: "Enter a valid email address." };
  if (!isRole(role)) return { error: "Pick a role." };

  const [existing] = await db().select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return { error: "That person already has an account." };

  const token = newToken();
  await db().insert(invites).values({
    tokenHash: hashToken(token),
    email,
    role,
    invitedBy: admin.id,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
  });
  revalidatePath("/settings/users");

  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const link = `${base}/invite/${token}`;
  if (smtpConfigured()) {
    try {
      await sendSmtp({ to: email, subject: "You're invited to PennyATS",
        text: `You've been invited to join PennyATS as a ${role}.\n\nAccept your invite within ${INVITE_DAYS} days:\n${link}` });
      return { message: `Invite emailed to ${email}. It expires in ${INVITE_DAYS} days.` };
    } catch {
      return { message: `Email delivery failed. Send this one-time invite link manually: ${link}` };
    }
  }
  return {
    message: `Invite created. Send this link to ${email}. It works once, expires in ${INVITE_DAYS} days, and is only shown now: ${link}`,
  };
}

export async function revokeInviteAction(inviteId: string): Promise<void> {
  await requireUser(canManageUsers);
  await db()
    .delete(invites)
    .where(and(eq(invites.id, inviteId), isNull(invites.acceptedAt)));
  revalidatePath("/settings/users");
}

/** Generate a one-time reset link for an active user; any older link is revoked. */
export async function createPasswordResetAction(userId: string, _: FormState, _form: FormData): Promise<FormState> {
  await requireUser(canManageUsers);
  // Demo visitors share accounts, so nobody may lock the others out or add real people.
  if (isDemoMode()) return { error: DEMO_BLOCKED };
  if (!isUuid(userId)) return { error: "User not found." };

  const token = newToken();
  const target = await db().transaction(async (tx) => {
    // Lock the account so concurrent requests cannot leave two usable links.
    const [user] = await tx.select({ id: users.id, email: users.email, active: users.active })
      .from(users).where(eq(users.id, userId)).for("update");
    if (!user || !user.active) return null;
    await tx.delete(passwordResets).where(eq(passwordResets.userId, userId));
    await tx.insert(passwordResets).values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + RESET_HOURS * 60 * 60 * 1000),
    });
    return user;
  });
  if (!target) return { error: "Active user not found." };

  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const link = `${base}/reset/${token}`;
  if (smtpConfigured()) {
    try {
      await sendSmtp({ to: target.email, subject: "Reset your PennyATS password",
        text: `Reset your PennyATS password within ${RESET_HOURS} hours:\n${link}\n\nIf you did not expect this, ask an administrator.` });
      return { message: `Password reset emailed to ${target.email}.` };
    } catch {
      return { message: `Email delivery failed. Send this one-time reset link manually: ${link}` };
    }
  }
  return {
    message: `Reset link for ${target.email}. Send it to them now. It works once, expires in ${RESET_HOURS} hours, and is only shown here: ${link}`,
  };
}

/** Change a role or deactivate/reactivate an account without deleting its attribution. */
export async function updateUserAction(userId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireUser(canManageUsers);
  // Demo visitors share accounts, so nobody may lock the others out or add real people.
  if (isDemoMode()) return { error: DEMO_BLOCKED };
  if (!isUuid(userId)) return { error: "User not found." };

  const intent = form.get("intent");
  if (intent !== "role" && intent !== "deactivate" && intent !== "reactivate") {
    return { error: "Invalid change." };
  }
  const role = form.get("role");
  if (intent === "role" && !isRole(role)) return { error: "Pick a role." };
  const requestedRole = intent === "role" && isRole(role) ? role : null;
  if (intent === "deactivate" && form.get("confirm") !== "on") {
    return { error: "Confirm that you want to deactivate this user." };
  }

  const result = await db().transaction(async (tx) => {
    // Serialize role and status changes so two admins cannot each remove the other last admin.
    await tx.execute(sql`select pg_advisory_xact_lock(21472, 1)`);
    const [target] = await tx.select().from(users).where(eq(users.id, userId));
    if (!target) return { error: "User not found." } as const;

    const nextRole = requestedRole ?? target.role;
    const nextActive = intent === "deactivate" ? false : intent === "reactivate" ? true : target.active;
    const [{ n }] = await tx.select({ n: count() }).from(users)
      .where(and(eq(users.role, "admin"), eq(users.active, true)));
    if (removesLastAdmin({
      currentRole: target.role,
      currentActive: target.active,
      nextRole,
      nextActive,
      activeAdminCount: n,
    })) {
      return { error: "The last active admin cannot be demoted or deactivated." } as const;
    }

    if (nextRole === target.role && nextActive === target.active) {
      return { message: "No change needed." } as const;
    }
    await tx.update(users).set({ role: nextRole, active: nextActive }).where(eq(users.id, userId));
    if (target.active && !nextActive) {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }
    return { message: intent === "role" ? "Role saved." : nextActive ? "User reactivated." : "User deactivated." } as const;
  });

  revalidatePath("/settings/users");
  return result;
}
