import { createRedactor, restore } from "@pennyats/redact";
import { anthropicProvider, openaiProvider } from "./providers";
import type { AiConfig, AiProvider, CompletionRequest, ProviderName } from "./types";

export * from "./types";
export { DEFAULT_MODELS } from "./providers";

/** Build the config from environment variables. Returns null when AI is off. */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv = process.env): AiConfig | null {
  const provider = env.AI_PROVIDER as ProviderName | undefined;
  const apiKey = env.AI_API_KEY;
  if (!provider || !apiKey) return null;
  if (provider !== "anthropic" && provider !== "openai") return null;
  return {
    provider,
    apiKey,
    model: env.AI_MODEL || undefined,
    redactPii: env.AI_REDACT_PII !== "false",
    baseUrl: env.AI_BASE_URL || undefined,
  };
}

export function createProvider(config: AiConfig): AiProvider {
  switch (config.provider) {
    case "anthropic":
      return anthropicProvider(config);
    case "openai":
      return openaiProvider(config);
  }
}

export interface AiClient {
  /** Run a completion, redacting PII on the way out and restoring it on the way back. */
  complete(req: CompletionRequest): Promise<string>;
}

/**
 * Returns an AI client, or null when no provider is configured.
 * Every AI feature should check for null and hide itself, so the product
 * behaves as a normal ATS when AI is off.
 */
export function getAiClient(config: AiConfig | null = aiConfigFromEnv()): AiClient | null {
  if (!config) return null;
  const provider = createProvider(config);
  const shouldRedact = config.redactPii !== false;

  return {
    async complete(req) {
      if (!shouldRedact) return provider.complete(req);
      // One redactor for the whole request so placeholders never collide.
      const redactor = createRedactor();
      const out = await provider.complete({
        ...req,
        system: req.system === undefined ? undefined : redactor.redact(req.system),
        prompt: redactor.redact(req.prompt),
      });
      return restore(out, redactor.map);
    },
  };
}

export const aiEnabled = (config: AiConfig | null = aiConfigFromEnv()) => config !== null;
