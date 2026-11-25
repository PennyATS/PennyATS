"use server";

import { availabilityContext, parseAvailabilityWindows, replaceAvailabilityWindows } from "@/lib/availability";

export type AvailabilityState = { error?: string; submitted?: boolean } | undefined;

export async function submitAvailabilityAction(token: string, source: "availability_link" | "booking_fallback",
  _: AvailabilityState, form: FormData): Promise<AvailabilityState> {
  const context = await availabilityContext(token, source);
  if (!context?.application.stageId) return { error: "This availability link is no longer available." };
  const timeZone = String(form.get("timeZone") ?? "").trim();
  const parsed = parseAvailabilityWindows(String(form.get("windows") ?? ""), timeZone);
  if (!parsed.ok) return { error: parsed.error };
  await replaceAvailabilityWindows(context.application.id, context.application.stageId, source, parsed.value);
  return { submitted: true };
}
