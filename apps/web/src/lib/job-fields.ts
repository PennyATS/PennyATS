/** Optional job details beyond title and description: compensation, people, planning. Pure, so it's testable. */

export const EMPLOYMENT_TYPES = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  internship: "Internship",
  temporary: "Temporary",
} as const;

export const WORKPLACE_TYPES = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" } as const;

export const PRIORITIES = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" } as const;

export const PAY_PERIODS = { year: "per year", hour: "per hour" } as const;

export const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD", "INR", "SGD", "JPY", "CHF", "SEK", "MXN", "BRL"] as const;

export type JobDetails = {
  employmentType: keyof typeof EMPLOYMENT_TYPES | null;
  workplaceType: keyof typeof WORKPLACE_TYPES | null;
  requisitionId: string | null;
  compCurrency: string | null;
  compPeriod: keyof typeof PAY_PERIODS | null;
  compMin: number | null;
  compMid: number | null;
  compMax: number | null;
  compPublic: boolean;
  equityNote: string | null;
  hiringManagerId: string | null;
  recruiterId: string | null;
  targetStartDate: string | null;
  priority: keyof typeof PRIORITIES | null;
  confidential: boolean;
  internalNotes: string | null;
};

type Read = (name: string, max?: number) => string | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oneOf<T extends string>(value: string | null, options: Record<T, string>): T | null {
  return value && Object.hasOwn(options, value) ? (value as T) : null;
}

/** "120,000", "$120k", "95.5" → whole number; blank → null; anything else → NaN. */
export function parseAmount(raw: string | null): number | null {
  if (!raw) return null;
  const text = raw.replace(/[\s,$€£¥]/g, "").toLowerCase();
  const match = /^(\d+(?:\.\d+)?)(k)?$/.exec(text);
  if (!match) return Number.NaN;
  const n = Number(match[1]) * (match[2] ? 1000 : 1);
  return Math.round(n);
}

/**
 * Read the optional job details from a form. Nothing here is required. Returns an error
 * only for values that can't be right (a min above the max, a non-number salary).
 */
export function parseJobDetails(read: Read, checked: (name: string) => boolean): { value: JobDetails } | { error: string } {
  const amounts = { compMin: parseAmount(read("compMin", 20)), compMid: parseAmount(read("compMid", 20)), compMax: parseAmount(read("compMax", 20)) };
  for (const [key, n] of Object.entries(amounts)) {
    if (n !== null && (!Number.isFinite(n) || n < 0 || n > 100_000_000)) {
      const label = key === "compMin" ? "Minimum" : key === "compMid" ? "Midpoint" : "Maximum";
      return { error: `${label} compensation must be a number, like 120000 or 120k.` };
    }
  }
  const { compMin, compMax } = amounts;
  let { compMid } = amounts;
  if (compMin !== null && compMax !== null && compMin > compMax) return { error: "Minimum compensation is above the maximum." };
  if (compMid !== null && ((compMin !== null && compMid < compMin) || (compMax !== null && compMid > compMax))) {
    return { error: "Midpoint compensation must be between the minimum and maximum." };
  }
  // Fill the midpoint when only the range was given.
  if (compMid === null && compMin !== null && compMax !== null) compMid = Math.round((compMin + compMax) / 2);

  const currency = read("compCurrency", 3)?.toUpperCase() ?? null;
  const start = read("targetStartDate", 10);
  const hm = read("hiringManagerId", 64);
  const recruiter = read("recruiterId", 64);
  const hasComp = compMin !== null || compMax !== null || compMid !== null;

  return {
    value: {
      employmentType: oneOf(read("employmentType", 20), EMPLOYMENT_TYPES),
      workplaceType: oneOf(read("workplaceType", 20), WORKPLACE_TYPES),
      requisitionId: read("requisitionId", 50),
      compCurrency: currency && (CURRENCIES as readonly string[]).includes(currency) ? currency : hasComp ? "USD" : null,
      compPeriod: oneOf(read("compPeriod", 10), PAY_PERIODS) ?? (hasComp ? "year" : null),
      compMin,
      compMid,
      compMax,
      compPublic: checked("compPublic"),
      equityNote: read("equityNote", 200),
      hiringManagerId: hm && UUID.test(hm) ? hm : null,
      recruiterId: recruiter && UUID.test(recruiter) ? recruiter : null,
      targetStartDate: start && /^\d{4}-\d{2}-\d{2}$/.test(start) && !Number.isNaN(Date.parse(start)) ? start : null,
      priority: oneOf(read("priority", 10), PRIORITIES),
      confidential: checked("confidential"),
      internalNotes: read("internalNotes", 5000),
    },
  };
}

/** "$120,000 – $150,000 per year", or null when there's no range to show. */
export function formatCompensation(job: Pick<JobDetails, "compCurrency" | "compPeriod" | "compMin" | "compMax">): string | null {
  const { compMin: min, compMax: max } = job;
  if (min === null && max === null) return null;
  const fmt = (n: number) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: job.compCurrency ?? "USD", maximumFractionDigits: 0 }).format(n);
    } catch {
      return `${job.compCurrency ?? ""} ${n.toLocaleString("en-US")}`.trim();
    }
  };
  const range = min !== null && max !== null && min !== max ? `${fmt(min)} – ${fmt(max)}` : min !== null && max === null ? `From ${fmt(min)}` : min === null ? `Up to ${fmt(max!)}` : fmt(min);
  return job.compPeriod ? `${range} ${PAY_PERIODS[job.compPeriod]}` : range;
}
