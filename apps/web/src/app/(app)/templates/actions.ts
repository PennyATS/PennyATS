"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { emailTemplateFolders, emailTemplates } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { htmlToText, sanitizeEmailHtml } from "@/lib/email-templates";
import { field, isUuid } from "@/lib/validation";

const MAX_HTML = 100_000;

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === "23505";
}

/* ---------- Folders ---------- */

export async function createFolderAction(_: FormState, form: FormData): Promise<FormState> {
  await requireUser("templates.manage");
  const name = field(form, "name", 80);
  if (!name) return { error: "Name the folder." };
  let id: string;
  try {
    [{ id }] = await db().insert(emailTemplateFolders).values({ name }).returning({ id: emailTemplateFolders.id });
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "A folder with that name already exists." };
    throw err;
  }
  revalidatePath("/templates");
  redirect(`/templates?folder=${id}`);
}

export async function renameFolderAction(folderId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireUser("templates.manage");
  if (!isUuid(folderId)) return { error: "Folder not found." };
  const name = field(form, "name", 80);
  if (!name) return { error: "Name the folder." };
  try {
    await db().update(emailTemplateFolders).set({ name }).where(eq(emailTemplateFolders.id, folderId));
  } catch (err) {
    if (isUniqueViolation(err)) return { error: "A folder with that name already exists." };
    throw err;
  }
  revalidatePath("/templates");
  return { message: "Folder renamed." };
}

/** Deleting a folder keeps its templates; they become unfiled. */
export async function deleteFolderAction(folderId: string): Promise<void> {
  await requireUser("templates.manage");
  if (!isUuid(folderId)) return;
  await db().delete(emailTemplateFolders).where(eq(emailTemplateFolders.id, folderId));
  revalidatePath("/templates");
  redirect("/templates");
}

/* ---------- Templates ---------- */

async function folderFrom(form: FormData): Promise<{ ok: true; id: string | null } | { ok: false }> {
  const raw = field(form, "folderId", 64);
  if (!raw) return { ok: true, id: null };
  if (!isUuid(raw)) return { ok: false };
  const [folder] = await db().select({ id: emailTemplateFolders.id }).from(emailTemplateFolders)
    .where(eq(emailTemplateFolders.id, raw));
  return folder ? { ok: true, id: folder.id } : { ok: false };
}

/** Create (id null) or update a template. The editor's HTML is sanitized here, never trusted. */
export async function saveTemplateAction(templateId: string | null, _: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser("templates.manage");
  if (templateId && !isUuid(templateId)) return { error: "Template not found." };
  const name = field(form, "name", 120);
  const subject = field(form, "subject", 200);
  const raw = form.get("bodyHtml");
  if (typeof raw === "string" && raw.length > MAX_HTML) return { error: "The email body is too long." };
  const bodyHtml = sanitizeEmailHtml(typeof raw === "string" ? raw : "");
  const body = htmlToText(bodyHtml);
  if (!name || !subject) return { error: "Name and subject are required." };
  if (!body) return { error: "Write the email body." };
  const folder = await folderFrom(form);
  if (!folder.ok) return { error: "Folder not found." };

  if (templateId) {
    const [updated] = await db().update(emailTemplates)
      .set({ name, subject, body, bodyHtml, folderId: folder.id, updatedAt: new Date() })
      .where(eq(emailTemplates.id, templateId)).returning({ id: emailTemplates.id });
    if (!updated) return { error: "Template not found." };
    revalidatePath("/templates");
    revalidatePath(`/templates/${templateId}`);
    return { message: "Template saved." };
  }
  const [created] = await db().insert(emailTemplates)
    .values({ name, subject, body, bodyHtml, folderId: folder.id, createdBy: user.id })
    .returning({ id: emailTemplates.id });
  revalidatePath("/templates");
  redirect(`/templates/${created.id}?created=1`);
}

export async function duplicateTemplateAction(templateId: string): Promise<void> {
  const user = await requireUser("templates.manage");
  if (!isUuid(templateId)) return;
  const [source] = await db().select().from(emailTemplates).where(eq(emailTemplates.id, templateId));
  if (!source) return;
  const [copy] = await db().insert(emailTemplates).values({
    name: `Copy of ${source.name}`.slice(0, 120), subject: source.subject, body: source.body,
    bodyHtml: source.bodyHtml, folderId: source.folderId, createdBy: user.id,
  }).returning({ id: emailTemplates.id });
  revalidatePath("/templates");
  redirect(`/templates/${copy.id}`);
}

/** Stages that auto-send this template stop sending (the setting is cleared by the foreign key). */
export async function deleteTemplateAction(templateId: string): Promise<void> {
  await requireUser("templates.manage");
  if (!isUuid(templateId)) return;
  const [deleted] = await db().delete(emailTemplates).where(eq(emailTemplates.id, templateId))
    .returning({ folderId: emailTemplates.folderId });
  revalidatePath("/templates");
  redirect(deleted?.folderId ? `/templates?folder=${deleted.folderId}` : "/templates");
}
