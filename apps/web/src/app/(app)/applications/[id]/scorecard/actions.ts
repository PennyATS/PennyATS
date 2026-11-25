"use server";

import { sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { scorecards } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/hiring";
import { loadScorecardContext } from "@/lib/scorecard-context";
import { parseScorecard } from "@/lib/scorecards";

/**
 * Anyone who can see the application can submit stage feedback, interviewers included.
 * Interview feedback is limited to that interview's interviewers and to recruiters.
 */
export async function submitScorecardAction(
  applicationId: string,
  interviewId: string | null,
  _: FormState,
  form: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const ctx = await loadScorecardContext(user, applicationId, interviewId);
  if (!ctx) return { error: "You can't submit a scorecard for this." };

  const parsed = parseScorecard(form, ctx.attributes);
  if (!parsed.ok) return { error: parsed.error };
  const { app, stageName, interview } = ctx;

  await db().transaction(async (tx) => {
    // Submitting again edits your earlier scorecard: one per interviewer per interview,
    // or per stage when it isn't tied to an interview.
    const insert = tx
      .insert(scorecards)
      .values({ applicationId: app.id, authorId: user.id, stageName, interviewId: interview?.id ?? null, ...parsed.value });
    const set = { ...parsed.value, updatedAt: new Date() };
    if (interview) {
      await insert.onConflictDoUpdate({
        target: [scorecards.interviewId, scorecards.authorId],
        targetWhere: sql`interview_id is not null`,
        set,
      });
    } else {
      await insert.onConflictDoUpdate({
        target: [scorecards.applicationId, scorecards.authorId, scorecards.stageName],
        targetWhere: sql`interview_id is null`,
        set,
      });
    }
    await logActivity(tx, {
      applicationId: app.id,
      actorId: user.id,
      type: "scorecard_submitted",
      data: interview ? { stage: stageName, interview: interview.name } : { stage: stageName },
    });
  });

  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/jobs/${app.jobId}`);
  redirect(`/candidates/${app.candidateId}`);
}
