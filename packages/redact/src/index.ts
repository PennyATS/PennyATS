/**
 * Lightweight, dependency-free PII redaction applied before text is sent to
 * an AI provider. Replaces common identifiers with stable placeholders and
 * returns a map so placeholders can be restored in the model's output.
 *
 * This is best-effort pattern matching, not a guarantee. Names and free-text
 * identifiers are not detected.
 */

export interface RedactionResult {
  text: string;
  /** placeholder -> original value */
  map: Record<string, string>;
}

const PATTERNS: { kind: string; regex: RegExp }[] = [
  { kind: "EMAIL", regex: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { kind: "URL", regex: /https?:\/\/[^\s)]+/g },
  { kind: "PHONE", regex: /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/g },
];

export interface Redactor {
  /** Redact one piece of text. Placeholders are numbered across every call on this redactor. */
  redact(input: string): string;
  /** placeholder -> original value, for everything redacted so far */
  readonly map: Record<string, string>;
}

/**
 * Use one redactor per model request, so the prompt and the system message share
 * numbering. Two separate redactions would both start at [EMAIL_1] for different
 * people, and restoring the reply would then swap their details.
 */
export function createRedactor(): Redactor {
  const map: Record<string, string> = {};
  const counters: Record<string, number> = {};
  const seen = new Map<string, string>();

  return {
    map,
    redact(input) {
      let text = input;
      for (const { kind, regex } of PATTERNS) {
        text = text.replace(regex, (match) => {
          const existing = seen.get(match);
          if (existing) return existing;
          counters[kind] = (counters[kind] ?? 0) + 1;
          const placeholder = `[${kind}_${counters[kind]}]`;
          map[placeholder] = match;
          seen.set(match, placeholder);
          return placeholder;
        });
      }
      return text;
    },
  };
}

/** Redact a single string. For a request with several parts, use createRedactor(). */
export function redact(input: string): RedactionResult {
  const r = createRedactor();
  return { text: r.redact(input), map: r.map };
}

/** Put original values back into model output. */
export function restore(text: string, map: Record<string, string>): string {
  let out = text;
  for (const [placeholder, original] of Object.entries(map)) {
    out = out.split(placeholder).join(original);
  }
  return out;
}
