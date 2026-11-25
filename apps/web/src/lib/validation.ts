/** Small, typed input helpers. No validation library on purpose. */

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

// Deliberately loose: one @, something on both sides, a dot in the domain.
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export function slugify(value: string): string {
  return (
    value
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "job"
  );
}

/** Read a trimmed string field from FormData; empty becomes null. */
export function field(form: FormData, name: string, maxLength = 500): string | null {
  const raw = form.get(name);
  if (typeof raw !== "string") return null;
  const value = raw.trim().slice(0, maxLength);
  return value === "" ? null : value;
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
export const RESUME_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt", ".rtf"] as const;

export function checkResume(name: string, size: number): string | null {
  const lower = name.toLowerCase();
  if (!RESUME_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return `Resume must be one of: ${RESUME_EXTENSIONS.join(", ")}.`;
  }
  if (size > RESUME_MAX_BYTES) return "Resume must be 5 MB or smaller.";
  if (size === 0) return "Resume file is empty.";
  return null;
}

export type CandidateInput = {
  fullName: string;
  email: string | null;
  phone: string | null;
  linkedinUrl: string | null;
  location: string | null;
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Shared by the public apply form (email required) and manual add (email optional). */
export function parseCandidate(form: FormData, opts: { requireEmail: boolean }): Parsed<CandidateInput> {
  const fullName = field(form, "fullName", 200);
  const rawEmail = field(form, "email", 254);
  const linkedinUrl = field(form, "linkedinUrl", 500);

  if (!fullName) return { ok: false, error: "Name is required." };
  if (opts.requireEmail && !rawEmail) return { ok: false, error: "Email is required." };
  const email = rawEmail ? normalizeEmail(rawEmail) : null;
  if (email && !isEmail(email)) return { ok: false, error: "Enter a valid email address." };
  if (linkedinUrl && !isHttpUrl(linkedinUrl)) {
    return { ok: false, error: "LinkedIn URL must start with https://" };
  }

  return {
    ok: true,
    value: {
      fullName,
      email,
      phone: field(form, "phone", 50),
      linkedinUrl,
      location: field(form, "location", 200),
    },
  };
}

/** Route params go straight into uuid columns; Postgres errors on malformed ids, so check first. */
export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
