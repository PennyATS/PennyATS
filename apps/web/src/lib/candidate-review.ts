/** Pure helpers for reviewing candidates: tags, rejection reasons, the dashboard pipeline snapshot. */

/* ---------- Tags ---------- */

const MAX_TAGS = 30;
const MAX_TAG_LENGTH = 40;

/** One tag: lowercase, no leading `#`, spaces to hyphens, only letters, digits, `-`, `_`, `+`, `.`. */
export function normalizeTag(raw: string): string | null {
  const tag = raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\p{L}\p{N}\-_+.]/gu, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_TAG_LENGTH);
  return tag || null;
}

/** Split "#swe, bay area #remote" style input into normalized, de-duplicated tags. */
export function parseTags(input: string): string[] {
  const parts = input.includes(",") ? input.split(",") : input.split(/\s+(?=#)|\s+/);
  return mergeTags([], parts);
}

/** Add tags to an existing list, keeping order and dropping duplicates. */
export function mergeTags(existing: readonly string[], added: readonly string[]): string[] {
  const out: string[] = [];
  for (const raw of [...existing, ...added]) {
    const tag = normalizeTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out.slice(0, MAX_TAGS);
}

/* ---------- Rejection reasons ---------- */

export const REJECTION_REASON_GROUPS = [
  {
    label: "Qualifications",
    reasons: [
      "Does not meet minimum qualifications",
      "Not enough relevant experience",
      "Technical skills gap",
      "Did not pass assessment",
      "Communication",
      "Values or team alignment",
      "Overqualified",
    ],
  },
  {
    label: "Eligibility and logistics",
    reasons: [
      "Work authorization or eligibility",
      "Location or relocation mismatch",
      "Compensation mismatch",
      "Potentially fraudulent application",
      "Duplicate application",
      "Unresponsive",
    ],
  },
  {
    label: "Candidate decision",
    reasons: ["Candidate withdrew interest", "Accepted another offer"],
  },
  {
    label: "Role",
    reasons: ["Hired another candidate", "Position filled", "Position closed or on hold"],
  },
  { label: "Other", reasons: ["Other"] },
] as const;

export const REJECTION_REASONS: readonly string[] = REJECTION_REASON_GROUPS.flatMap((g) => g.reasons);

/**
 * Stored reason text: the standard reason, plus the note after an em dash when given.
 * Returns null when the reason isn't one of the standard ones.
 */
export function rejectionReasonText(reason: string | null, note: string | null): string | null {
  if (!reason || !REJECTION_REASONS.includes(reason)) return null;
  const trimmed = note?.trim();
  return trimmed ? `${reason} — ${trimmed}` : reason;
}

/** The standard reason part of a stored reason, for grouping in reports. Free text stays as is. */
export function rejectionReasonKey(stored: string): string {
  const [head] = stored.split(" — ");
  return REJECTION_REASONS.includes(head) ? head : stored;
}

/* ---------- Dashboard pipeline snapshot ---------- */

const SNAPSHOT_ORDER = ["applied", "recruiter screen", "technical interview", "onsite"] as const;
const SNAPSHOT_LABELS: Record<(typeof SNAPSHOT_ORDER)[number] | "offer", string> = {
  applied: "Applied",
  "recruiter screen": "Recruiter screen",
  "technical interview": "Technical interview",
  onsite: "Onsite",
  offer: "Offer",
};

/**
 * Active applications per stage in a fixed order: Applied, Recruiter screen, Technical
 * interview, Onsite, every other stage as "Other stages", then Offer. Names match
 * case-insensitively, so per-job stages with the same name add up.
 */
export function pipelineSnapshot(counts: readonly { name: string | null; total: number }[]): { label: string; total: number }[] {
  const totals = new Map<string, number>();
  let other = 0;
  for (const { name, total } of counts) {
    const key = (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
    if ((SNAPSHOT_ORDER as readonly string[]).includes(key) || key === "offer") {
      totals.set(key, (totals.get(key) ?? 0) + total);
    } else {
      other += total;
    }
  }
  return [
    ...SNAPSHOT_ORDER.map((key) => ({ label: SNAPSHOT_LABELS[key], total: totals.get(key) ?? 0 })),
    { label: "Other stages", total: other },
    { label: SNAPSHOT_LABELS.offer, total: totals.get("offer") ?? 0 },
  ];
}
