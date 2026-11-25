export type ProviderName = "anthropic" | "openai";

export interface AiConfig {
  provider: ProviderName;
  apiKey: string;
  /** Optional model override; each adapter has a sensible default. */
  model?: string;
  /** Redact emails, phones and URLs before sending. Default true. */
  redactPii?: boolean;
  /**
   * Optional API base URL, e.g. an OpenAI-compatible server such as Ollama or LM Studio
   * (http://localhost:11434/v1) or a company proxy. Defaults to the provider's public API.
   */
  baseUrl?: string;
}

/** A provider call failed. `message` is safe to show to users; `detail` is for server logs. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly detail: string,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface CompletionRequest {
  system?: string;
  prompt: string;
  maxTokens?: number;
}

export interface AiProvider {
  readonly name: ProviderName;
  complete(req: CompletionRequest): Promise<string>;
}
