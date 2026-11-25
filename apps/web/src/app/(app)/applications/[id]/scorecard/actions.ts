"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { jobs, scorecards } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { currentStageName, getApplicationFor, logActivity } from "@/lib/hiring";
import { parseScorecard } from "@/lib/scorecards";
import { isUuid } from "@/lib/validation";

/** Anyone who can see the application can submit feedback, interviewers included. */
export async function submitScorecardAction(
  applicationId: string,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const app = isUuid(applicationId) ? await getApplicationFor(user, applicationId) : null;
  if (!app) return { error: "Application not found." };

  const [job] = await db()
    .select({ attributes: jobs.scorecardAttributes })
    .from(jobs)
    .where(eq(jobs.id, app.jobId));
  const parsed = parseScorecard(form, job?.attributes ?? []);
  if (!parsed.ok) return { error: parsed.error };

  const stageName = await currentStageName(app.stageId);
  await db().transaction(async (tx) => {
    // Submitting again for the same stage edits your earlier scorecard.
    await tx
      .insert(scorecards)
      .values({ applicationId: app.id, authorId: user.id, stageName, ...parsed.value })
      .onConflictDoUpdate({
        target: [scorecards.applicationId, scorecards.authorId, scorecards.stageName],
        set: { ...parsed.value, updatedAt: new Date() },
      });
    await logActivity(tx, {
      applicationId: app.id,
      actorId: user.id,
      type: "scorecard_submitted",
      data: { stage: stageName },
    });
  });

  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/jobs/${app.jobId}`);
  redirect(`/candidates/${app.candidateId}`);
}
