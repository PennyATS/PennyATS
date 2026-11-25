/**
 * Email template rules: merge fields, HTML sanitizing, and the plain-text fallback.
 * Pure functions with no Next.js or database imports, so they are easy to test.
 */
import { Parser } from "htmlparser2";
import sanitizeHtml from "sanitize-html";

import type { MergeToken, MergeValues } from "./merge-fields";

export { MERGE_FIELDS, EXAMPLE_VALUES, mergeValues, type MergeToken, type MergeValues } from "./merge-fields";

const TOKEN = /{{\s*([a-z_]+)\s*}}/g;

function substitute(value: string, values: MergeValues, encode: (s: string) => string): string {
  return value.replace(TOKEN, (match, token: string) =>
    Object.hasOwn(values, token) ? encode(values[token as MergeToken]) : match);
}

/** Fill merge fields in a subject or plain-text body. Unknown tokens are left as typed. */
export function renderEmailTemplate(value: string, values: MergeValues): string {
  return substitute(value, values, (s) => s);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Fill merge fields in sanitized HTML. Values are escaped, so a candidate's name can't inject markup. */
export function renderEmailHtml(html: string, values: MergeValues): string {
  return substitute(html, values, escapeHtml);
}

const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "s", "a", "ul", "ol", "li", "h2", "h3", "blockquote", "hr", "code"],
  allowedAttributes: { a: ["href", "target", "rel"], ol: ["start"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  disallowedTagsMode: "discard",
  transformTags: {
    b: "strong",
    i: "em",
    h1: "h2",
    a: (tagName, attribs) => {
      const safe: Record<string, string> = attribs.href ? { href: attribs.href, target: "_blank", rel: "noopener noreferrer" } : {};
      return { tagName, attribs: safe };
    },
  },
  allowedSchemesAppliedToAttributes: ["href"],
};

/** Sanitize editor output against a small allowlist. Run on the server before storing anything. */
export function sanitizeEmailHtml(html: string): string {
  const clean = sanitizeHtml(html, SANITIZE);
  // The editor emits an empty paragraph for a blank document.
  return clean.replace(/^(<p><\/p>|\s)+|(<p><\/p>|\s)+$/g, "");
}

/** Turn plain text (templates written before rich text) into paragraphs of HTML. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** The HTML to show and send for a template, falling back to its plain-text body. */
export function templateHtml(template: { bodyHtml: string; body: string }): string {
  return template.bodyHtml.trim() ? template.bodyHtml : textToHtml(template.body);
}

const BLOCKS = new Set(["p", "h2", "h3", "blockquote", "ul", "ol", "hr"]);

/**
 * Plain-text version of sanitized HTML for the text part of an email: paragraphs separated
 * by blank lines, list items prefixed, and links written as "text (url)".
 */
export function htmlToText(html: string): string {
  let out = "";
  const lists: { ordered: boolean; n: number }[] = [];
  const links: string[] = [];
  let linkText = "";
  const blankLine = () => {
    out = out.replace(/[ \t]+$/, "");
    if (out && !out.endsWith("\n\n")) out += out.endsWith("\n") ? "\n" : "\n\n";
  };
  const parser = new Parser(
    {
      onopentag(name, attribs) {
        if (BLOCKS.has(name) && lists.length === 0) blankLine();
        if (name === "br") out += "\n";
        if (name === "hr") out += "---";
        if (name === "ul" || name === "ol") {
          if (lists.length) out += "\n";
          lists.push({ ordered: name === "ol", n: Number(attribs.start) || 1 });
        }
        if (name === "li") {
          const list = lists[lists.length - 1];
          if (!out.endsWith("\n") && out) out += "\n";
          out += "  ".repeat(Math.max(0, lists.length - 1)) + (list?.ordered ? `${list.n++}. ` : "- ");
        }
        if (name === "a") {
          links.push(attribs.href ?? "");
          linkText = "";
        }
      },
      ontext(text) {
        const decoded = text.replace(/\s+/g, " ");
        const trimmed = out.endsWith("\n") || out === "" ? decoded.replace(/^ /, "") : decoded;
        out += trimmed;
        if (links.length) linkText += trimmed;
      },
      onclosetag(name) {
        if (name === "a") {
          const href = links.pop() ?? "";
          const target = href.replace(/^mailto:/, "");
          if (href && target !== linkText.trim()) out += ` (${target})`;
        }
        if (name === "ul" || name === "ol") lists.pop();
        if (BLOCKS.has(name) && lists.length === 0) blankLine();
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Wrap rendered HTML in a minimal document with inline styles most email clients respect. */
export function emailDocument(bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1d2c24;"><div style="max-width:600px;">${bodyHtml}</div></body></html>`;
}
