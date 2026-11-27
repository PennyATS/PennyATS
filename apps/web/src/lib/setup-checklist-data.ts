import { count, eq } from "drizzle-orm";
import { invites, jobs, settings, users } from "@pennyats/db";
import { aiStatus } from "./ai";
import { getCompanyName } from "./candidate-email";
import { BRAND } from "./brand";
import { db } from "./db";
import { calendarConnectionState } from "./google-calendar";
import { smtpConfigured } from "./smtp";
import {
  checklistSteps,
  readChecklistState,
  type ChecklistState,
  type SetupFacts,
} from "./setup-checklist";

const KEY = "setup_checklist";

export async function getChecklistState(): Promise<ChecklistState> {
  const [row] = await db().select().from(settings).where(eq(settings.key, KEY));
  return readChecklistState(row?.value);
}

export async function saveChecklistState(value: ChecklistState): Promise<void> {
  await db()
    .insert(settings)
    .values({ key: KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** Whether each step is already done, read from the workspace. */
export async function loadSetupFacts(userId: string): Promise<SetupFacts> {
  const [companyName, [jobCount], [userCount], [inviteCount], calendar] = await Promise.all([
    getCompanyName(),
    db().select({ n: count() }).from(jobs),
    db().select({ n: count() }).from(users),
    db().select({ n: count() }).from(invites),
    calendarConnectionState(userId),
  ]);
  return {
    company: companyName !== BRAND.name,
    job: jobCount.n > 0,
    email: smtpConfigured(),
    calendar: Boolean(calendar),
    ai: aiStatus() !== null,
    team: userCount.n > 1 || inviteCount.n > 0,
  };
}

export async function loadChecklist(userId: string) {
  const [facts, state] = await Promise.all([loadSetupFacts(userId), getChecklistState()]);
  return { state, steps: checklistSteps(facts, state) };
}
