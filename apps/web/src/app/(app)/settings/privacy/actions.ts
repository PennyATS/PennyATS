"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/form";
import { requireUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";
import { deleteCandidates, expiredCandidateIds, getPrivacySettings, savePrivacySettings } from "@/lib/privacy";
import { parsePrivacyForm } from "@/lib/privacy-rules";

export async function savePrivacyAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireUser(canManageUsers);
  const parsed = parsePrivacyForm(form);
  if (!parsed.ok) return { error: parsed.error };
  await savePrivacySettings(parsed.value, admin.id);
  revalidatePath("/settings/privacy");
  return { message: "Saved." };
}

/** Delete everyone currently past the retention period. Admin only, needs the confirm box. */
export async function purgeNowAction(_: FormState, form: FormData): Promise<FormState> {
  const admin = await requireUser(canManageUsers);
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm permanent deletion." };
  const { retentionMonths } = await getPrivacySettings();
  if (!retentionMonths) return { error: "Set a retention period first." };

  // Recomputed here rather than trusting the count the page showed.
  const ids = await expiredCandidateIds(retentionMonths);
  const count = await deleteCandidates(ids, {
    actorId: admin.id,
    reason: `Retention: no activity for ${retentionMonths} months`,
    action: "retention_purge",
  });
  revalidatePath("/settings/privacy");
  revalidatePath("/candidates");
  return { message: count === 0 ? "Nobody is past the retention period." : `Deleted ${count} candidate${count === 1 ? "" : "s"}.` };
}
