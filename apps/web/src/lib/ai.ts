import { eq } from "drizzle-orm";
import { AiError, DEFAULT_MODELS, aiConfigFromEnv, getAiClient, type AiClient } from "@pennyats/ai";
import { settings } from "@pennyats/db";
import { keyHint, readAiSettings, type AiFeature, type AiSettings } from "./ai-rules";
import { db } from "./db";
import { isDemoMode } from "./demo";
import { createRateLimiter } from "./rate-limit";

// Every AI feature goes through here: it checks the provider is configured and the feature
// is switched on, and the client from @pennyats/ai applies redaction.

const SETTINGS_KEY = "ai";

/** Provider config from the environment. Always null on the public demo, so AI stays off there. */
function aiConfig() {
  return isDemoMode() ? null : aiConfigFromEnv();
}

export async function getAiSettings(): Promise<AiSettings> {
  const [row] = await db().select().from(settings).where(eq(settings.key, SETTINGS_KEY));
  return readAiSettings(row?.value, process.env.AI_REDACT_PII !== "false");
}

export async function saveAiSettings(value: AiSettings): Promise<void> {
  await db()
    .insert(settings)
    .values({ key: SETTINGS_KEY, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

/** What the settings page shows. Never includes the key itself. */
export function aiStatus() {
  const config = aiConfig();
  if (!config) return null;
  return {
    provider: config.provider,
    model: config.model || DEFAULT_MODELS[config.provider],
    baseUrl: config.baseUrl ?? null,
    key: keyHint(config.apiKey),
  };
}

/** A client for this feature, or null when AI isn't configured or the feature is switched off. */
export async function getAiFor(feature: AiFeature | "test"): Promise<AiClient | null> {
  const config = aiConfig();
  if (!config) return null;
  const s = await getAiSettings();
  if (feature !== "test" && !s.features[feature]) return null;
  return getAiClient({ ...config, redactPii: s.redactPii });
}

export async function isAiFeatureOn(feature: AiFeature): Promise<boolean> {
  if (!aiConfig()) return false;
  return (await getAiSettings()).features[feature];
}

// Calls cost money on the admin's account, so cap them per user.
const aiLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });
export const allowAiCall = (userId: string) => aiLimiter(userId);

/** Turn any failure into a message that's safe to show. Details go to the server log. */
export function aiErrorMessage(err: unknown): string {
  console.error("AI request failed:", err instanceof AiError ? `${err.message} ${err.status ?? ""} ${err.detail}` : err);
  return err instanceof AiError ? err.message : "The AI request failed. Check the server log.";
}
