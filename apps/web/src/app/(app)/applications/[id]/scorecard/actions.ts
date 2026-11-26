"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { submitScorecard } from "@/lib/pipeline";
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
  const { app } = ctx;
  // Submitting again edits your earlier scorecard: one per interviewer per interview,
  // or per stage when it isn't tied to an interview.
  await submitScorecard(user, ctx, parsed.value);

  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/jobs/${app.jobId}`);
  redirect(`/candidates/${app.candidateId}`);
}
