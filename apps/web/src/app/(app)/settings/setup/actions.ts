"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/form";
import { allowAiCall, getAiFor } from "@/lib/ai";
import { requireUser } from "@/lib/auth";
import { calendarConnectionState, googleCalendarConfigured, googleFreeBusy } from "@/lib/google-calendar";
import { canManageUsers } from "@/lib/permissions";
import { isSetupStepId, skipStep, testMessage, unskipStep, type TestOutcome } from "@/lib/setup-checklist";
import { getChecklistState, saveChecklistState } from "@/lib/setup-checklist-data";
import { smtpConfigured, verifySmtp } from "@/lib/smtp";

function refresh() {
  revalidatePath("/settings/setup");
  revalidatePath("/");
}

function result(step: "email" | "calendar" | "ai", outcome: TestOutcome): FormState {
  const { ok, text } = testMessage(step, outcome);
  return ok ? { message: text } : { error: text };
}

export async function setStepSkippedAction(stepId: string, skipped: boolean): Promise<void> {
  await requireUser(canManageUsers);
  if (!isSetupStepId(stepId)) return;
  const state = await getChecklistState();
  await saveChecklistState(skipped ? skipStep(state, stepId) : unskipStep(state, stepId));
  refresh();
}

export async function setChecklistDismissedAction(dismissed: boolean): Promise<void> {
  await requireUser(canManageUsers);
  await saveChecklistState({ ...(await getChecklistState()), dismissed });
  refresh();
}

export async function testEmailStepAction(_: FormState): Promise<FormState> {
  await requireUser(canManageUsers);
  if (!smtpConfigured()) return result("email", "not_configured");
  try {
    await verifySmtp();
    return result("email", "ok");
  } catch (err) {
    console.error("Setup checklist SMTP test failed:", err);
    return result("email", "failed");
  }
}

export async function testCalendarStepAction(_: FormState): Promise<FormState> {
  const user = await requireUser(canManageUsers);
  if (!googleCalendarConfigured()) return result("calendar", "not_configured");
  if (!(await calendarConnectionState(user.id))) return result("calendar", "not_connected");
  try {
    await googleFreeBusy(user.id, new Date(), new Date(Date.now() + 7 * 86400000));
    return result("calendar", "ok");
  } catch (err) {
    console.error("Setup checklist calendar test failed:", err);
    return result("calendar", "failed");
  }
}

export async function testAiStepAction(_: FormState): Promise<FormState> {
  const user = await requireUser(canManageUsers);
  const ai = await getAiFor("test");
  if (!ai) return result("ai", "not_configured");
  if (!allowAiCall(user.id)) return result("ai", "rate_limited");
  try {
    await ai.complete({ prompt: "Reply with the single word: ready", maxTokens: 10 });
    return result("ai", "ok");
  } catch (err) {
    console.error("Setup checklist AI test failed:", err);
    return result("ai", "failed");
  }
}
