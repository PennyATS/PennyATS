/** Privacy settings and retention rules. Pure functions, so they can be unit tested. */

export type PrivacySettings = {
  /** Short notice shown above the apply button, e.g. who you are and how long you keep data. */
  noticeText: string | null;
  /** Link to your full privacy policy. */
  noticeUrl: string | null;
  /** Applicants must tick a box agreeing to the notice before they can apply. */
  requireConsent: boolean;
  /** Delete rejected and withdrawn candidates this many months after their last activity. Null = never. */
  retentionMonths: number | null;
};

export const DEFAULT_PRIVACY: PrivacySettings = {
  noticeText: null,
  noticeUrl: null,
  requireConsent: false,
  retentionMonths: null,
};

export const MAX_RETENTION_MONTHS = 120;

/** Read settings stored as JSON, falling back to defaults for anything missing or malformed. */
export function readPrivacySettings(value: unknown): PrivacySettings {
  if (!value || typeof value !== "object") return { ...DEFAULT_PRIVACY };
  const v = value as Record<string, unknown>;
  const months = v.retentionMonths;
  return {
    noticeText: typeof v.noticeText === "string" && v.noticeText.trim() ? v.noticeText : null,
    noticeUrl: typeof v.noticeUrl === "string" && isHttpUrl(v.noticeUrl) ? v.noticeUrl : null,
    requireConsent: v.requireConsent === true,
    retentionMonths:
      typeof months === "number" && Number.isInteger(months) && months >= 1 && months <= MAX_RETENTION_MONTHS
        ? months
        : null,
  };
}

export function parsePrivacyForm(
  form: FormData,
): { ok: true; value: PrivacySettings } | { ok: false; error: string } {
  const text = String(form.get("noticeText") ?? "").trim().slice(0, 2000);
  const url = String(form.get("noticeUrl") ?? "").trim();
  const monthsRaw = String(form.get("retentionMonths") ?? "").trim();

  if (url && !isHttpUrl(url)) return { ok: false, error: "Privacy policy link must start with https://" };

  let retentionMonths: number | null = null;
  if (monthsRaw) {
    const n = Number(monthsRaw);
    if (!Number.isInteger(n) || n < 1 || n > MAX_RETENTION_MONTHS) {
      return { ok: false, error: `Retention must be a whole number of months from 1 to ${MAX_RETENTION_MONTHS}, or blank.` };
    }
    retentionMonths = n;
  }

  const requireConsent = form.get("requireConsent") === "on";
  if (requireConsent && !text && !url) {
    return { ok: false, error: "Add notice text or a policy link before requiring consent." };
  }

  return {
    ok: true,
    value: { noticeText: text || null, noticeUrl: url || null, requireConsent, retentionMonths },
  };
}

/** Candidates whose last activity is before this date are past retention. */
export function retentionCutoff(months: number, now: Date = new Date()): Date {
  const cutoff = new Date(now);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  return cutoff;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
