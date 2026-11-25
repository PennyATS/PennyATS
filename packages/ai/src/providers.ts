import { AiError, type AiConfig, type AiProvider, type CompletionRequest } from "./types";

// Defaults are overridable via AI_MODEL or settings. Keep them easy to change.
export const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-4o-mini",
} as const;

const DEFAULT_BASE_URLS = {
  anthropic: "https://api.anthropic.com/v1",
  openai: "https://api.openai.com/v1",
} as const;

const TIMEOUT_MS = 60_000;

/** POST JSON with a timeout, turning failures into an AiError with a user-safe message. */
async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    throw new AiError(
      timedOut ? "The AI provider took too long to respond." : "Couldn't reach the AI provider.",
      null,
      String(err),
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    const message =
      res.status === 401 || res.status === 403
        ? "The AI provider rejected the API key."
        : res.status === 429
          ? "The AI provider is rate limiting requests. Try again shortly."
          : `The AI provider returned an error (${res.status}).`;
    throw new AiError(message, res.status, detail.slice(0, 2000));
  }
  return res.json();
}

const base = (config: AiConfig) => (config.baseUrl || DEFAULT_BASE_URLS[config.provider]).replace(/\/+$/, "");

export function anthropicProvider(config: AiConfig): AiProvider {
  return {
    name: "anthropic",
    async complete({ system, prompt, maxTokens = 1024 }: CompletionRequest) {
      const data = (await post(
        `${base(config)}/messages`,
        { "x-api-key": config.apiKey, "anthropic-version": "2023-06-01" },
        {
          model: config.model || DEFAULT_MODELS.anthropic,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: prompt }],
        },
      )) as { content: { type: string; text?: string }[] };
      return data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
    },
  };
}

export function openaiProvider(config: AiConfig): AiProvider {
  return {
    name: "openai",
    async complete({ system, prompt, maxTokens = 1024 }: CompletionRequest) {
      const data = (await post(
        `${base(config)}/chat/completions`,
        { authorization: `Bearer ${config.apiKey}` },
        {
          model: config.model || DEFAULT_MODELS.openai,
          max_tokens: maxTokens,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt },
          ],
        },
      )) as { choices: { message: { content: string } }[] };
      return data.choices[0]?.message?.content ?? "";
    },
  };
}
