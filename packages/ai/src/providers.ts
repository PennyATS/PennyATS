import type { AiConfig, AiProvider, CompletionRequest } from "./types";

// Defaults are overridable via AI_MODEL or settings. Keep them easy to change.
const DEFAULT_MODELS = {
  anthropic: "claude-sonnet-5-5",
  openai: "gpt-4o-mini",
} as const;

export function anthropicProvider(config: AiConfig): AiProvider {
  return {
    name: "anthropic",
    async complete({ system, prompt, maxTokens = 1024 }: CompletionRequest) {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.model || DEFAULT_MODELS.anthropic,
          max_tokens: maxTokens,
          system,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      if (!res.ok) {
        throw new Error(`Anthropic request failed (${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as { content: { type: string; text?: string }[] };
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
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model || DEFAULT_MODELS.openai,
          max_tokens: maxTokens,
          messages: [
            ...(system ? [{ role: "system", content: system }] : []),
            { role: "user", content: prompt },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`OpenAI request failed (${res.status}): ${await res.text()}`);
      }
      const data = (await res.json()) as { choices: { message: { content: string } }[] };
      return data.choices[0]?.message?.content ?? "";
    },
  };
}
