"use server";

import { and, asc, count, eq, like, max, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEFAULT_STAGES, applications, jobTeam, jobs, stages, users } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { aiErrorMessage, allowAiCall, getAiFor } from "@/lib/ai";
import { jobDescriptionPrompt } from "@/lib/ai-rules";
import { moveApplication } from "@/lib/hiring";
import { MAX_ATTRIBUTES, parseAttributes } from "@/lib/scorecards";
import { canManageHiring } from "@/lib/permissions";
import { field, isUuid, slugify } from "@/lib/validation";

const STATUSES = ["draft", "open", "closed"] as const;
type JobStatus = (typeof STATUSES)[number];

function parseJob(form: FormData) {
  const title = field(form, "title", 200);
  const status = form.get("status");
  const headcountInput = form.get("headcount");
  const headcountText = typeof headcountInput === "string" ? headcountInput.trim() : "";
  const headcount = headcountText ? Number(headcountText) : null;
  if (!title) return { error: "Title is required." } as const;
  if (!STATUSES.includes(status as JobStatus)) return { error: "Pick a status." } as const;
  if (headcountText && (!/^(0|[1-9]\d{0,4})$/.test(headcountText) || headcount === null || headcount > 10000))
    return { error: "Headcount must be a whole number from 0 to 10,000." } as const;
  return {
    value: {
      title,
      status: status as JobStatus,
      department: field(form, "department", 200),
      team: field(form, "team", 200),
      location: field(form, "location", 200),
      region: field(form, "region", 200),
      headcount,
      description: field(form, "description", 20_000),
    },
  } as const;
}

/** "Senior Engineer" -> "senior-engineer", or "senior-engineer-2" if taken. */
async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title);
  const taken = await db()
    .select({ slug: jobs.slug })
    .from(jobs)
    .where(or(eq(jobs.slug, base), like(jobs.slug, `${base}-%`)));
  const used = new Set(taken.map((r) => r.slug));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export async function createJobAction(_: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser(canManageHiring);
  const parsed = parseJob(form);
  if ("error" in parsed) return { error: parsed.error };

  const slug = await uniqueSlug(parsed.value.title);
  const jobId = await db().transaction(async (tx) => {
    const [job] = await tx
      .insert(jobs)
      .values({ ...parsed.value, slug, createdBy: user.id })
      .returning({ id: jobs.id });
    await tx
      .insert(stages)
      .values(DEFAULT_STAGES.map((name, position) => ({ jobId: job.id, name, position })));
    return job.id;
  });
  redirect(`/jobs/${jobId}`);
}

export async function updateJobAction(jobId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireUser(canManageHiring);
  const parsed = parseJob(form);
  if ("error" in parsed) return { error: parsed.error };
  // The slug stays the same on edit so careers page links keep working.
  await db()
    .update(jobs)
    .set({ ...parsed.value, updatedAt: new Date() })
    .where(eq(jobs.id, jobId));
  revalidatePath(`/jobs/${jobId}`);
  return { message: "Saved." };
}

/* ---------- Stages ---------- */

function stagePath(jobId: string) {
  revalidatePath(`/jobs/${jobId}/edit`);
  revalidatePath(`/jobs/${jobId}`);
}

export async function addStageAction(jobId: string, form: FormData): Promise<void> {
  await requireUser(canManageHiring);
  const name = field(form, "name", 100);
  if (!name) return;
  const [{ top }] = await db()
    .select({ top: max(stages.position) })
    .from(stages)
    .where(eq(stages.jobId, jobId));
  await db().insert(stages).values({ jobId, name, position: (top ?? -1) + 1 });
  stagePath(jobId);
}

export async function renameStageAction(jobId: string, stageId: string, form: FormData): Promise<void> {
  await requireUser(canManageHiring);
  const name = field(form, "name", 100);
  if (!name) return;
  await db()
    .update(stages)
    .set({ name })
    .where(and(eq(stages.id, stageId), eq(stages.jobId, jobId)));
  stagePath(jobId);
}

/** Swap a stage with its neighbour above (-1) or below (+1). */
export async function moveStageAction(jobId: string, stageId: string, direction: -1 | 1): Promise<void> {
  await requireUser(canManageHiring);
  await db().transaction(async (tx) => {
    const list = await tx
      .select()
      .from(stages)
      .where(eq(stages.jobId, jobId))
      .orderBy(asc(stages.position));
    const i = list.findIndex((s) => s.id === stageId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= list.length) return;
    // Rewrite positions as 0..n-1 so gaps left by deletes don't matter.
    [list[i], list[j]] = [list[j], list[i]];
    for (const [position, stage] of list.entries()) {
      await tx.update(stages).set({ position }).where(eq(stages.id, stage.id));
    }
  });
  stagePath(jobId);
}

/** Only empty stages can be deleted, so no application loses its place. */
export async function deleteStageAction(jobId: string, stageId: string): Promise<void> {
  await requireUser(canManageHiring);
  const [{ n }] = await db()
    .select({ n: count() })
    .from(applications)
    .where(eq(applications.stageId, stageId));
  if (n > 0) return;
  await db()
    .delete(stages)
    .where(and(eq(stages.id, stageId), eq(stages.jobId, jobId)));
  stagePath(jobId);
}

/* ---------- Hiring team ---------- */

export async function addTeamMemberAction(jobId: string, form: FormData): Promise<void> {
  await requireUser(canManageHiring);
  const userId = field(form, "userId", 64);
  if (!userId || !isUuid(userId)) return;
  const [exists] = await db().select({ id: users.id }).from(users).where(eq(users.id, userId));
  if (!exists) return;
  await db().insert(jobTeam).values({ jobId, userId }).onConflictDoNothing();
  stagePath(jobId);
}

export async function removeTeamMemberAction(jobId: string, userId: string): Promise<void> {
  await requireUser(canManageHiring);
  await db()
    .delete(jobTeam)
    .where(and(eq(jobTeam.jobId, jobId), eq(jobTeam.userId, userId)));
  stagePath(jobId);
}

/* ---------- Pipeline board ---------- */

/** Called by the kanban board when a card is dropped or moved with the arrow buttons. */
export async function moveCardAction(applicationId: string, stageId: string): Promise<{ ok: boolean }> {
  const user = await requireUser(canManageHiring);
  const moved = await moveApplication(user, applicationId, stageId);
  if (!moved) return { ok: false };
  revalidatePath(`/jobs/${moved.jobId}`);
  revalidatePath(`/candidates/${moved.candidateId}`);
  return { ok: true };
}

/* ---------- Scorecard attributes ---------- */

export async function updateAttributesAction(jobId: string, _: FormState, form: FormData): Promise<FormState> {
  await requireUser(canManageHiring);
  const raw = form.get("attributes");
  const attributes = parseAttributes(typeof raw === "string" ? raw : "");
  // Existing scorecards keep their ratings under the old names, so renaming here is safe.
  await db().update(jobs).set({ scorecardAttributes: attributes, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  revalidatePath(`/jobs/${jobId}/edit`);
  return { message: attributes.length ? "Saved." : "Saved. Scorecards will only ask for a recommendation." };
}

/* ---------- AI: draft a job description ---------- */

export async function draftDescriptionAction(input: {
  title: string;
  department: string;
  location: string;
  notes: string;
}): Promise<{ text: string } | { error: string }> {
  const user = await requireUser(canManageHiring);
  const ai = await getAiFor("jobDescriptions");
  if (!ai) return { error: "AI job descriptions are turned off." };
  const title = input.title.trim().slice(0, 200);
  if (!title) return { error: "Add a job title first." };
  if (!allowAiCall(user.id)) return { error: "Too many AI requests. Try again in an hour." };

  const clip = (s: string, n: number) => s.trim().slice(0, n) || null;
  try {
    const text = await ai.complete(
      jobDescriptionPrompt({
        title,
        department: clip(input.department, 200),
        location: clip(input.location, 200),
        notes: clip(input.notes, 5000),
      }),
    );
    return { text: text.trim() };
  } catch (err) {
    return { error: aiErrorMessage(err) };
  }
}
