/**
 * Interview loop rules. Pure functions, so status and overdue logic are unit tested.
 *
 * An interview's status isn't stored; it's worked out from its timestamps, who is
 * assigned, and who has submitted a scorecard for it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Feedback counts as overdue this long after the interview happened. */
export const FEEDBACK_DUE_DAYS = 2;

export type InterviewStatus = "cancelled" | "to_schedule" | "scheduled" | "feedback_due" | "complete";

export const STATUS_LABELS: Record<InterviewStatus, string> = {
  cancelled: "Cancelled",
  to_schedule: "To schedule",
  scheduled: "Scheduled",
  feedback_due: "Feedback due",
  complete: "Complete",
};

export type InterviewState = {
  scheduledAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  /** User ids assigned to run the interview. */
  interviewerIds: string[];
  /** User ids who have submitted a scorecard for this interview. */
  submittedBy: string[];
};

export function interviewStatus(i: InterviewState, now: Date = new Date()): InterviewStatus {
  if (i.cancelledAt) return "cancelled";
  const submitted = new Set(i.submittedBy);
  const allIn = i.interviewerIds.length > 0 && i.interviewerIds.every((id) => submitted.has(id));
  if (allIn) return "complete";
  const happened = i.completedAt !== null || (i.scheduledAt !== null && i.scheduledAt <= now);
  if (happened) return i.interviewerIds.length === 0 && i.completedAt ? "complete" : "feedback_due";
  return i.scheduledAt ? "scheduled" : "to_schedule";
}

/** When the interview happened: marked complete, or its scheduled time once that's passed. */
export function heldAt(i: InterviewState, now: Date = new Date()): Date | null {
  if (i.completedAt) return i.completedAt;
  if (i.scheduledAt && i.scheduledAt <= now) return i.scheduledAt;
  return null;
}

/** Interviewers who still owe a scorecard. Empty unless feedback is due. */
export function missingFeedback(i: InterviewState, now: Date = new Date()): string[] {
  if (interviewStatus(i, now) !== "feedback_due") return [];
  const submitted = new Set(i.submittedBy);
  return i.interviewerIds.filter((id) => !submitted.has(id));
}

/** Feedback is overdue FEEDBACK_DUE_DAYS after the interview happened. */
export function isOverdue(i: InterviewState, now: Date = new Date()): boolean {
  const held = heldAt(i, now);
  return (
    interviewStatus(i, now) === "feedback_due" &&
    held !== null &&
    now.getTime() - held.getTime() > FEEDBACK_DUE_DAYS * DAY_MS
  );
}

/** The attributes an interview's scorecard asks about: its own focus list, or all of the job's. */
export function scorecardAttributes(interviewAttributes: string[], jobAttributes: string[]): string[] {
  if (interviewAttributes.length === 0) return jobAttributes;
  // Keep the job's order and drop anything the job no longer rates.
  const focus = new Set(interviewAttributes);
  const kept = jobAttributes.filter((a) => focus.has(a));
  return kept.length ? kept : jobAttributes;
}

/* ---------- Form parsing ---------- */

export type TemplateInput = {
  stageId: string;
  name: string;
  durationMinutes: number;
  attributes: string[];
  instructions: string | null;
  interviewerIds: string[];
};

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The interview plan form: one planned interview. */
export function parseTemplateForm(form: FormData): Parsed<TemplateInput> {
  const stageId = String(form.get("stageId") ?? "");
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const minutes = Number(form.get("durationMinutes") ?? 45);
  const instructions = String(form.get("instructions") ?? "").trim().slice(0, 4000);

  if (!UUID.test(stageId)) return { ok: false, error: "Pick a stage." };
  if (!name) return { ok: false, error: "Give the interview a name, like \"Technical interview\"." };
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 480) {
    return { ok: false, error: "Length must be between 5 and 480 minutes." };
  }

  const strings = (key: string) => form.getAll(key).filter((v): v is string => typeof v === "string");
  return {
    ok: true,
    value: {
      stageId,
      name,
      durationMinutes: minutes,
      attributes: [...new Set(strings("attributes").map((a) => a.trim()).filter(Boolean))].slice(0, 12),
      instructions: instructions || null,
      interviewerIds: [...new Set(strings("interviewerIds").filter((id) => UUID.test(id)))],
    },
  };
}

/**
 * A datetime-local value ("2026-11-24T14:30") plus the browser's UTC offset in minutes
 * (from Date.getTimezoneOffset()), turned into an exact moment. Empty clears the time.
 */
export function parseScheduledAt(local: string, offsetMinutes: number): Parsed<Date | null> {
  const value = local.trim();
  if (!value) return { ok: true, value: null };
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m || !Number.isFinite(offsetMinutes) || Math.abs(offsetMinutes) > 14 * 60) {
    return { ok: false, error: "Enter a valid date and time." };
  }
  const [, y, mo, d, h, mi] = m.map(Number);
  const utc = Date.UTC(y, mo - 1, d, h, mi) + offsetMinutes * 60 * 1000;
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return { ok: false, error: "Enter a valid date and time." };
  return { ok: true, value: date };
}

/** Resolve an explicit wall-clock time in an IANA zone. Reject DST gaps and ambiguous hours. */
export function parseZonedScheduledAt(local: string, timeZone: string): Parsed<Date> {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return { ok: false, error: "Enter a valid date and time." };
  const [, year, month, day, hour, minute] = match.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return { ok: false, error: "Enter a valid date and time." };
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    return { ok: false, error: "Choose a valid time zone." };
  }
  const wanted = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(wanted);
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() + 1 !== month || normalized.getUTCDate() !== day) {
    return { ok: false, error: "Enter a valid date and time." };
  }
  const partsAt = (instant: number) => {
    const parts = Object.fromEntries(formatter.formatToParts(instant).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  };
  const offsets = new Set([-86400000, 0, 86400000].map((delta) => partsAt(wanted + delta) - (wanted + delta)));
  const matches = [...offsets].map((offset) => wanted - offset).filter((instant) => partsAt(instant) === wanted).sort();
  if (matches.length !== 1) {
    return { ok: false, error: "This local time is skipped or repeated by a daylight saving change. Choose another time." };
  }
  return { ok: true, value: new Date(matches[0]) };
}

export function localInputInZone(instant: Date, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export type ScheduledConflict = {
  interviewId: string;
  interviewerId: string;
  interviewerName: string;
  scheduledAt: Date;
  durationMinutes: number;
};

export function overlappingInterviews(
  start: Date,
  durationMinutes: number,
  currentInterviewId: string,
  rows: ScheduledConflict[],
): ScheduledConflict[] {
  const end = start.getTime() + durationMinutes * 60000;
  return rows.filter((row) =>
    row.interviewId !== currentInterviewId &&
    row.scheduledAt.getTime() < end &&
    row.scheduledAt.getTime() + row.durationMinutes * 60000 > start.getTime(),
  );
}
