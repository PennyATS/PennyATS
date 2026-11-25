"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/form";
import { aiErrorMessage, allowAiCall, getAiFor, saveAiSettings } from "@/lib/ai";
import { parseAiForm } from "@/lib/ai-rules";
import { requireUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/permissions";

export async function saveAiSettingsAction(_: FormState, form: FormData): Promise<FormState> {
  await requireUser(canManageUsers);
  await saveAiSettings(parseAiForm(form));
  revalidatePath("/settings/ai");
  return { message: "Saved." };
}

/** Sends a tiny request to confirm the key, model and network path all work. */
export async function testAiAction(): Promise<FormState> {
  const admin = await requireUser(canManageUsers);
  const ai = await getAiFor("test");
  if (!ai) return { error: "AI isn't configured. Set AI_PROVIDER and AI_API_KEY first." };
  if (!allowAiCall(admin.id)) return { error: "Too many AI requests. Try again in an hour." };
  try {
    const reply = await ai.complete({ prompt: "Reply with the single word: ready", maxTokens: 10 });
    return { message: `Connected. The model replied: "${reply.trim().slice(0, 50)}"` };
  } catch (err) {
    return { error: aiErrorMessage(err) };
  }
}
