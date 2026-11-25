export type ProviderName = "anthropic" | "openai";

export interface AiConfig {
  provider: ProviderName;
  apiKey: string;
  /** Optional model override; each adapter has a sensible default. */
  model?: string;
  /** Redact emails, phones and URLs before sending. Default true. */
  redactPii?: boolean;
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
