"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { invites, users } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { hashToken, newToken, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageUsers, isRole } from "@/lib/permissions";
import { field, isEmail, normalizeEmail } from "@/lib/validation";

const INVITE_DAYS = 7;

/** Creates an invite and returns the link for the admin to send. Email sending comes later. */
export async function createInviteAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireUser(canManageUsers);
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
  return {
    message: `Invite created. Send this link to ${email}. It works once, expires in ${INVITE_DAYS} days, and is only shown now: ${base}/invite/${token}`,
  };
}

export async function revokeInviteAction(inviteId: string): Promise<void> {
  await requireUser(canManageUsers);
  await db()
    .delete(invites)
    .where(and(eq(invites.id, inviteId), isNull(invites.acceptedAt)));
  revalidatePath("/settings/users");
}
