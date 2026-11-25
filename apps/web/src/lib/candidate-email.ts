/**
 * Sending template emails to candidates, by hand from the profile or automatically when an
 * application enters a stage. Every attempt is recorded in `emails` (and so on the candidate
 * timeline), including the ones that were skipped because SMTP or the candidate's address is
 * missing. The app works without email: nothing here throws on a missing configuration.
 */
import { and, eq } from "drizzle-orm";
import { after } from "next/server";
import {
  applications, candidates, emails, emailTemplates, jobs, settings, stageSchedulingSettings, stages,
} from "@pennyats/db";
import { BRAND } from "./brand";
import { db } from "./db";
import {
  emailDocument, mergeValues, renderEmailHtml, renderEmailTemplate, templateHtml,
} from "./email-templates";
import { sendSmtp, smtpConfigured, type OutboundMessage } from "./smtp";

const COMPANY_KEY = "company";

/** The hiring company's name for `{{company_name}}`. Falls back to the product name. */
export async function getCompanyName(): Promise<string> {
  const [row] = await db().select().from(settings).where(eq(settings.key, COMPANY_KEY));
  const name = (row?.value as { name?: unknown } | undefined)?.name;
  return typeof name === "string" && name.trim() ? name.trim() : BRAND.name;
}

export async function saveCompanyName(name: string | null): Promise<void> {
  const value = { name: name ?? "" };
  await db().insert(settings).values({ key: COMPANY_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export type EmailAttempt =
  | { status: "sending"; id: string; deliver: () => Promise<"sent" | "failed"> }
  | { status: "skipped"; id: string; error: string }
  | { status: "duplicate" | "missing" };

const SMTP_FAILED = "SMTP did not confirm delivery.";

async function deliver(id: string, message: OutboundMessage): Promise<"sent" | "failed"> {
  try {
    await sendSmtp(message);
    await db().update(emails).set({ status: "sent", error: null, sentAt: new Date() }).where(eq(emails.id, id));
    return "sent";
  } catch {
    await db().update(emails).set({ status: "failed", error: SMTP_FAILED }).where(eq(emails.id, id));
    return "failed";
  }
}

/**
 * Render a template for one application and record the email. Returns a `deliver` function
 * when it should go out; the caller decides whether to await it or run it after the response.
 * A `triggerKey` makes the record unique, so the same automatic email is never sent twice.
 */
export async function prepareTemplateEmail(input: {
  applicationId: string;
  templateId: string;
  actorId: string | null;
  stageId?: string | null;
  triggerKey?: string | null;
}): Promise<EmailAttempt> {
  const [row] = await db()
    .select({
      candidateId: candidates.id, name: candidates.fullName, email: candidates.email,
      jobTitle: jobs.title, stageName: stages.name,
    })
    .from(applications)
    .innerJoin(candidates, eq(candidates.id, applications.candidateId))
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .leftJoin(stages, eq(stages.id, applications.stageId))
    .where(eq(applications.id, input.applicationId));
  const [template] = await db().select().from(emailTemplates).where(eq(emailTemplates.id, input.templateId));
  if (!row || !template) return { status: "missing" };

  const values = mergeValues({
    candidateName: row.name, jobTitle: row.jobTitle, companyName: await getCompanyName(), stageName: row.stageName,
  });
  const subject = renderEmailTemplate(template.subject, values).replace(/\s+/g, " ").trim();
  const text = renderEmailTemplate(template.body, values);
  const html = renderEmailHtml(templateHtml(template), values);
  const error = !row.email ? "Candidate has no email address." : !smtpConfigured() ? "SMTP is not configured." : null;

  const [record] = await db().insert(emails).values({
    candidateId: row.candidateId, applicationId: input.applicationId, templateId: template.id,
    stageId: input.stageId ?? null, subject, body: text, bodyHtml: html,
    status: error ? "skipped" : "sending", error, triggerKey: input.triggerKey ?? null, sentBy: input.actorId,
  }).onConflictDoNothing({ target: emails.triggerKey }).returning({ id: emails.id });
  if (!record) return { status: "duplicate" };
  if (error) return { status: "skipped", id: record.id, error };
  const message = { to: row.email!, subject, text, html: emailDocument(html) };
  return { status: "sending", id: record.id, deliver: () => deliver(record.id, message) };
}

/**
 * Call after a real stage move. If the stage has an email template, record it and send it
 * once the response is on its way, so a slow mail server never blocks the pipeline board.
 * Pass `stageId: null` for a new application to use the stage it was placed in.
 */
export async function sendStageEntryEmail(applicationId: string, stageId: string | null, actorId: string | null) {
  if (!stageId) {
    const [app] = await db().select({ stageId: applications.stageId }).from(applications)
      .where(eq(applications.id, applicationId));
    if (!app?.stageId) return;
    stageId = app.stageId;
  }
  const [setting] = await db()
    .select({ templateId: stageSchedulingSettings.emailTemplateId })
    .from(stageSchedulingSettings)
    .innerJoin(applications, and(eq(applications.id, applicationId), eq(applications.stageId, stageId),
      eq(applications.status, "active")))
    .where(eq(stageSchedulingSettings.stageId, stageId));
  if (!setting?.templateId) return;
  const attempt = await prepareTemplateEmail({
    applicationId, templateId: setting.templateId, actorId, stageId, triggerKey: `stage:${applicationId}:${stageId}`,
  });
  if (attempt.status === "sending") after(attempt.deliver);
}

/** Send a recorded email again after it failed or was skipped. Returns an error message or null. */
export async function retryEmail(id: string): Promise<string | null> {
  const [row] = await db()
    .select({ email: emails, to: candidates.email })
    .from(emails)
    .innerJoin(candidates, eq(candidates.id, emails.candidateId))
    .where(eq(emails.id, id));
  if (!row || (row.email.status !== "failed" && row.email.status !== "skipped")) return "This email can't be resent.";
  if (!row.to) return "Candidate has no email address.";
  if (!smtpConfigured()) return "SMTP is not configured.";
  // Claim the row so two clicks can't both send it.
  const [claimed] = await db().update(emails).set({ status: "sending", error: null })
    .where(and(eq(emails.id, id), eq(emails.status, row.email.status))).returning({ id: emails.id });
  if (!claimed) return "This email is already being sent.";
  const result = await deliver(id, {
    to: row.to, subject: row.email.subject, text: row.email.body,
    html: row.email.bodyHtml ? emailDocument(row.email.bodyHtml) : undefined,
  });
  return result === "sent" ? null : SMTP_FAILED;
}
