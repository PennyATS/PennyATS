/**
 * Boolean search queries: `python AND (django OR flask) -intern "machine learning"`.
 * Bare words are ANDed. `NOT word` and `-word` exclude. Quotes make a phrase.
 * Parsing never throws: stray operators and unbalanced parentheses are ignored.
 */

export type QueryNode =
  | { type: "term"; value: string }
  | { type: "not"; node: QueryNode }
  | { type: "and"; nodes: QueryNode[] }
  | { type: "or"; nodes: QueryNode[] };

type Token = { kind: "lparen" | "rparen" | "and" | "or" | "not" } | { kind: "term"; value: string; negated: boolean };

const MAX_TERMS = 20;
const MAX_TERM_LENGTH = 100;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const s = input.slice(0, 500);
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "(") {
      tokens.push({ kind: "lparen" });
      i++;
    } else if (c === ")") {
      tokens.push({ kind: "rparen" });
      i++;
    } else {
      let negated = false;
      if (c === "-" && i + 1 < s.length && !/\s/.test(s[i + 1])) {
        negated = true;
        i++;
      }
      let value: string;
      if (s[i] === '"') {
        const end = s.indexOf('"', i + 1);
        value = s.slice(i + 1, end === -1 ? s.length : end);
        i = end === -1 ? s.length : end + 1;
      } else {
        const start = i;
        while (i < s.length && !/[\s()]/.test(s[i])) i++;
        value = s.slice(start, i);
        if (!negated) {
          if (value === "AND" || value === "&&") {
            tokens.push({ kind: "and" });
            continue;
          }
          if (value === "OR" || value === "||") {
            tokens.push({ kind: "or" });
            continue;
          }
          if (value === "NOT") {
            tokens.push({ kind: "not" });
            continue;
          }
        }
      }
      value = value.trim().slice(0, MAX_TERM_LENGTH);
      if (value) tokens.push({ kind: "term", value, negated });
    }
  }
  return tokens;
}

/** Parse a query into a tree, or null when it has no terms. */
export function parseQuery(input: string): QueryNode | null {
  const tokens = tokenize(input);
  let pos = 0;
  let terms = 0;

  function parseOr(): QueryNode | null {
    const nodes: QueryNode[] = [];
    const first = parseAnd();
    if (first) nodes.push(first);
    while (pos < tokens.length && tokens[pos].kind === "or") {
      pos++;
      const next = parseAnd();
      if (next) nodes.push(next);
    }
    return nodes.length === 0 ? null : nodes.length === 1 ? nodes[0] : { type: "or", nodes };
  }

  function parseAnd(): QueryNode | null {
    const nodes: QueryNode[] = [];
    while (pos < tokens.length) {
      const t = tokens[pos];
      if (t.kind === "or" || t.kind === "rparen") break;
      if (t.kind === "and") {
        pos++;
        continue;
      }
      const node = parseUnary();
      if (node) nodes.push(node);
    }
    return nodes.length === 0 ? null : nodes.length === 1 ? nodes[0] : { type: "and", nodes };
  }

  function parseUnary(): QueryNode | null {
    const t = tokens[pos];
    if (t.kind === "not") {
      pos++;
      if (pos >= tokens.length) return null;
      const inner = parseUnary();
      return inner ? { type: "not", node: inner } : null;
    }
    if (t.kind === "lparen") {
      pos++;
      const inner = parseOr();
      if (pos < tokens.length && tokens[pos].kind === "rparen") pos++;
      return inner;
    }
    pos++;
    if (t.kind !== "term" || terms >= MAX_TERMS) return null;
    terms++;
    const term: QueryNode = { type: "term", value: t.value };
    return t.negated ? { type: "not", node: term } : term;
  }

  let root: QueryNode | null = null;
  const parts: QueryNode[] = [];
  // A stray ")" ends parseOr early; skip it and keep going so nothing after it is lost.
  while (pos < tokens.length) {
    const node = parseOr();
    if (node) parts.push(node);
    if (pos < tokens.length) pos++;
  }
  root = parts.length === 0 ? null : parts.length === 1 ? parts[0] : { type: "and", nodes: parts };
  return root;
}

/** Terms that must appear (not negated), for highlighting. */
export function positiveTerms(node: QueryNode | null): string[] {
  if (!node) return [];
  switch (node.type) {
    case "term":
      return [node.value];
    case "not":
      return [];
    default:
      return [...new Set(node.nodes.flatMap(positiveTerms))];
  }
}

/** Evaluate against plain text, used by tests and to explain matches. */
export function matchesText(node: QueryNode | null, text: string): boolean {
  if (!node) return true;
  const hay = text.toLowerCase();
  const visit = (n: QueryNode): boolean => {
    switch (n.type) {
      case "term":
        return hay.includes(n.value.toLowerCase());
      case "not":
        return !visit(n.node);
      case "and":
        return n.nodes.every(visit);
      case "or":
        return n.nodes.some(visit);
    }
  };
  return visit(node);
}

/** Escape LIKE wildcards so "50%" means the literal text. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
