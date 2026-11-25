"use server";

import type { FormState } from "@/components/form";
import { emailTemplates } from "@pennyats/db";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { canManageUsers } from "@/lib/permissions";
import { smtpConfigured, verifySmtp } from "@/lib/smtp";
import { field, isUuid } from "@/lib/validation";

export async function testSmtpAction(_: FormState): Promise<FormState> {
  await requireUser(canManageUsers);
  if (!smtpConfigured()) return { error: "Configure SMTP in the server environment first." };
  try { await verifySmtp(); return { message: "SMTP connection verified." }; }
  catch { return { error: "SMTP connection failed. Check host, TLS, and credentials." }; }
}

export async function saveEmailTemplateAction(id: string | null, _: FormState, form: FormData): Promise<FormState> {
  await requireUser(canManageUsers);
  const name = field(form, "name", 100);
  const subject = field(form, "subject", 200);
  const body = field(form, "body", 10000);
  if (!name || !subject || !body) return { error: "Name, subject, and body are required." };
  if (id && !isUuid(id)) return { error: "Template not found." };
  if (id) await db().update(emailTemplates).set({ name, subject, body }).where(eq(emailTemplates.id, id));
  else await db().insert(emailTemplates).values({ name, subject, body });
  revalidatePath("/settings/email");
  return { message: "Template saved." };
}

export async function deleteEmailTemplateAction(id: string): Promise<void> {
  await requireUser(canManageUsers);
  if (!isUuid(id)) return;
  await db().delete(emailTemplates).where(eq(emailTemplates.id, id));
  revalidatePath("/settings/email");
}
