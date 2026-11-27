"use server";

import type { FormState } from "@/components/form";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { saveCompanyName } from "@/lib/candidate-email";
import { smtpConfigured, verifySmtp } from "@/lib/smtp";
import { field } from "@/lib/validation";

export async function testSmtpAction(_: FormState): Promise<FormState> {
  await requireUser("settings.manage");
  if (!smtpConfigured()) return { error: "Configure SMTP in the server environment first." };
  try { await verifySmtp(); return { message: "SMTP connection verified." }; }
  catch { return { error: "SMTP connection failed. Check host, TLS, and credentials." }; }
}

export async function saveCompanyNameAction(_: FormState, form: FormData): Promise<FormState> {
  await requireUser("settings.manage");
  await saveCompanyName(field(form, "companyName", 120));
  revalidatePath("/settings/email");
  return { message: "Company name saved." };
}
