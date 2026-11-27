"use server";

import { and, eq } from "drizzle-orm";
import { jobs } from "@pennyats/db";
import type { FormState } from "@/components/form";
import { db } from "@/lib/db";
import { addApplication } from "@/lib/hiring";
import { deliverDueWebhooks } from "@/lib/webhooks";
import { getPrivacySettings } from "@/lib/privacy";
import { createRateLimiter } from "@/lib/rate-limit";
import { DEMO_LIMITS, isDemoMode } from "@/lib/demo";
import { clientIp } from "@/lib/request";
import { extensionOf, storage } from "@/lib/storage";
import { checkResume, parseCandidate } from "@/lib/validation";
import { sendStageEntryEmail } from "@/lib/candidate-email";
import { recordCareersFunnelEvent } from "@/lib/careers-funnel";

const applyLimiter = createRateLimiter({ limit: isDemoMode() ? DEMO_LIMITS.applyPerHour : 5, windowMs: 60 * 60 * 1000 });

const THANKS = "Thanks for applying. We'll be in touch.";

export async function applyAction(jobId: string, _: FormState, form: FormData): Promise<FormState> {
  // Honeypot: real people never see or fill the "website" field. Bots get a fake success.
  if (form.get("website")) return { message: THANKS };

  if (!applyLimiter(await clientIp())) {
    return { error: "Too many applications from your network. Try again later." };
  }

  const [job] = await db()
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "open"), eq(jobs.confidential, false)));
  if (!job) return { error: "This role is no longer accepting applications." };

  const parsed = parseCandidate(form, { requireEmail: true });
  if (!parsed.ok) return { error: parsed.error };

  const privacy = await getPrivacySettings();
  const consented = form.get("consent") === "on";
  if (privacy.requireConsent && !consented) {
    return { error: "Please confirm you've read the privacy notice." };
  }

  let resume: { key: string; name: string } | undefined;
  const file = form.get("resume");
  if (file instanceof File && file.size > 0) {
    const problem = checkResume(file.name, file.size);
    if (problem) return { error: problem };
    const key = await storage.put(new Uint8Array(await file.arrayBuffer()), extensionOf(file.name));
    resume = { key, name: file.name.slice(0, 200) };
  }

  const result = await db().transaction((tx) =>
    addApplication(tx, {
      jobId: job.id,
      candidate: { ...parsed.value, source: "Careers page" },
      resume,
      consentedAt: privacy.requireConsent && consented ? new Date() : undefined,
      actorId: null,
    }),
  );
  if (result.created && result.applicationId) await sendStageEntryEmail(result.applicationId, null, null);
  void deliverDueWebhooks();
  // Count every real submit (including a repeat apply for the same email) for the careers funnel.
  void recordCareersFunnelEvent(job.id, "submit");
  // Same reply whether or not they had already applied, so the form can't be used
  // to check whether someone is a candidate.
  return { message: THANKS };
}
