/** Scorecard rules. Pure functions, so they can be unit tested without a database. */

export const RECOMMENDATIONS = ["strong_no", "no", "yes", "strong_yes"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  strong_no: "Strong no",
  no: "No",
  yes: "Yes",
  strong_yes: "Strong yes",
};

/** 1 to 4 with no middle option, so interviewers have to lean one way. */
export const RATING_LABELS: Record<number, string> = {
  1: "Weak",
  2: "Mixed",
  3: "Good",
  4: "Excellent",
};

export const MAX_ATTRIBUTES = 12;

export type ScorecardInput = {
  ratings: Record<string, number>;
  recommendation: Recommendation;
  summary: string | null;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Read a scorecard form. Ratings are optional per attribute (skip what you didn't assess),
 * but the overall recommendation is required.
 */
export function parseScorecard(form: FormData, attributes: readonly string[]): Parsed<ScorecardInput> {
  const ratings: Record<string, number> = {};
  attributes.forEach((name, i) => {
    const raw = form.get(`rating-${i}`);
    if (typeof raw !== "string" || raw === "") return;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 4) ratings[name] = n;
  });

  const rec = form.get("recommendation");
  if (!RECOMMENDATIONS.includes(rec as Recommendation)) {
    return { ok: false, error: "Pick an overall recommendation." };
  }

  const rawSummary = form.get("summary");
  const summary = typeof rawSummary === "string" ? rawSummary.trim().slice(0, 10_000) : "";

  return {
    ok: true,
    value: { ratings, recommendation: rec as Recommendation, summary: summary || null },
  };
}

/** One attribute per line; trimmed, de-duplicated, capped. Used by the job edit form. */
export function parseAttributes(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim().slice(0, 80);
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_ATTRIBUTES) break;
  }
  return out;
}

/** Count of each recommendation, in strong-no-to-strong-yes order, skipping zeros. */
export function summarize(recs: readonly Recommendation[]): { recommendation: Recommendation; count: number }[] {
  return RECOMMENDATIONS.map((r) => ({ recommendation: r, count: recs.filter((x) => x === r).length })).filter(
    (x) => x.count > 0,
  );
}

/**
 * Interviewers see other people's scorecards on an application only after submitting
 * their own, so earlier feedback doesn't sway them. Admins and recruiters always see all.
 */
export function canSeeOthersScorecards(opts: { managesHiring: boolean; hasSubmitted: boolean }): boolean {
  return opts.managesHiring || opts.hasSubmitted;
}
