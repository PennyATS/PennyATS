import assert from "node:assert/strict";
import { test } from "node:test";
import {
  interviewStatus,
  isOverdue,
  missingFeedback,
  parseScheduledAt,
  parseZonedScheduledAt,
  localInputInZone,
  overlappingInterviews,
  parseTemplateForm,
  scorecardAttributes,
  type InterviewState,
} from "./interviews";

const NOW = new Date("2026-11-24T18:00:00Z");
const hoursFromNow = (h: number) => new Date(NOW.getTime() + h * 60 * 60 * 1000);

const base = (over: Partial<InterviewState> = {}): InterviewState => ({
  scheduledAt: null,
  completedAt: null,
  cancelledAt: null,
  interviewerIds: ["ana", "ben"],
  submittedBy: [],
  ...over,
});

test("status moves from to schedule, to scheduled, to feedback due, to complete", () => {
  assert.equal(interviewStatus(base(), NOW), "to_schedule");
  assert.equal(interviewStatus(base({ scheduledAt: hoursFromNow(24) }), NOW), "scheduled");
  // Once the scheduled time passes, feedback is due without anyone marking it done.
  assert.equal(interviewStatus(base({ scheduledAt: hoursFromNow(-1) }), NOW), "feedback_due");
  assert.equal(interviewStatus(base({ completedAt: hoursFromNow(-1) }), NOW), "feedback_due");
  assert.equal(interviewStatus(base({ scheduledAt: hoursFromNow(-1), submittedBy: ["ana"] }), NOW), "feedback_due");
  assert.equal(interviewStatus(base({ scheduledAt: hoursFromNow(-1), submittedBy: ["ana", "ben"] }), NOW), "complete");
});

test("cancelled wins over everything", () => {
  assert.equal(interviewStatus(base({ cancelledAt: NOW, submittedBy: ["ana", "ben"] }), NOW), "cancelled");
});

test("an interview with no assigned interviewers is complete once marked done", () => {
  const none = base({ interviewerIds: [] });
  assert.equal(interviewStatus(none, NOW), "to_schedule");
  assert.equal(interviewStatus({ ...none, completedAt: NOW }, NOW), "complete");
  // Scorecards from people who weren't assigned don't complete an interview that has interviewers.
  assert.equal(interviewStatus(base({ completedAt: NOW, submittedBy: ["someone-else"] }), NOW), "feedback_due");
});

test("missing feedback lists only assigned interviewers who haven't submitted", () => {
  assert.deepEqual(missingFeedback(base({ completedAt: NOW, submittedBy: ["ben"] }), NOW), ["ana"]);
  assert.deepEqual(missingFeedback(base({ scheduledAt: hoursFromNow(5) }), NOW), []);
});

test("feedback is overdue 2 days after the interview happened", () => {
  assert.equal(isOverdue(base({ scheduledAt: hoursFromNow(-47) }), NOW), false);
  assert.equal(isOverdue(base({ scheduledAt: hoursFromNow(-49) }), NOW), true);
  // Marking it complete earlier than the scheduled time counts from completion.
  assert.equal(isOverdue(base({ scheduledAt: hoursFromNow(24), completedAt: hoursFromNow(-72) }), NOW), true);
  assert.equal(isOverdue(base({ scheduledAt: hoursFromNow(-72), submittedBy: ["ana", "ben"] }), NOW), false);
});

test("scorecard attributes use the interview's focus in the job's order, or all of them", () => {
  const job = ["Coding", "System design", "Communication"];
  assert.deepEqual(scorecardAttributes([], job), job);
  assert.deepEqual(scorecardAttributes(["Communication", "Coding"], job), ["Coding", "Communication"]);
  // Attributes the job has since removed are dropped; if none remain, fall back to all.
  assert.deepEqual(scorecardAttributes(["Retired skill"], job), job);
});

function form(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
const STAGE = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

test("parseTemplateForm validates and de-duplicates", () => {
  const ok = parseTemplateForm(
    form([
      ["stageId", STAGE],
      ["name", "  Technical interview "],
      ["durationMinutes", "60"],
      ["attributes", "Coding"],
      ["attributes", "Coding"],
      ["interviewerIds", USER],
      ["interviewerIds", "not-a-uuid"],
      ["instructions", ""],
    ]),
  );
  assert.deepEqual(ok, {
    ok: true,
    value: { stageId: STAGE, name: "Technical interview", durationMinutes: 60, attributes: ["Coding"], instructions: null, interviewerIds: [USER] },
  });
  assert.equal(parseTemplateForm(form([["stageId", STAGE], ["name", ""]])).ok, false);
  assert.equal(parseTemplateForm(form([["stageId", "x"], ["name", "Screen"]])).ok, false);
  assert.equal(parseTemplateForm(form([["stageId", STAGE], ["name", "Screen"], ["durationMinutes", "2"]])).ok, false);
});

test("parseScheduledAt turns a local time plus the browser's offset into an exact moment", () => {
  // 2:30 PM in Los Angeles in November (UTC-8, getTimezoneOffset() = 480) is 22:30 UTC.
  assert.deepEqual(parseScheduledAt("2026-11-24T14:30", 480), { ok: true, value: new Date("2026-11-24T22:30:00Z") });
  assert.deepEqual(parseScheduledAt("", 480), { ok: true, value: null });
  assert.equal(parseScheduledAt("tomorrow", 480).ok, false);
  assert.equal(parseScheduledAt("2026-11-24T14:30", 99999).ok, false);
});

test("explicit time zones handle normal, skipped, and repeated local times", () => {
  const normal = parseZonedScheduledAt("2026-12-03T10:30", "America/Los_Angeles");
  assert.deepEqual(normal, { ok: true, value: new Date("2026-12-03T18:30:00Z") });
  if (normal.ok) assert.equal(localInputInZone(normal.value, "America/Los_Angeles"), "2026-12-03T10:30");
  assert.equal(parseZonedScheduledAt("2026-03-08T02:30", "America/Los_Angeles").ok, false);
  assert.equal(parseZonedScheduledAt("2026-11-01T01:30", "America/Los_Angeles").ok, false);
  assert.equal(parseZonedScheduledAt("2026-02-30T10:00", "UTC").ok, false);
  assert.equal(parseZonedScheduledAt("2026-12-03T10:30", "not/a-zone").ok, false);
});

test("manual conflicts overlap only shared interviewer time, excluding the interview itself", () => {
  const at = new Date("2026-12-03T18:30:00Z");
  const rows = [
    { interviewId: "other", interviewerId: "alex", interviewerName: "Alex", scheduledAt: new Date("2026-12-03T18:00:00Z"), durationMinutes: 60 },
    { interviewId: "current", interviewerId: "alex", interviewerName: "Alex", scheduledAt: at, durationMinutes: 30 },
    { interviewId: "ends-at-start", interviewerId: "alex", interviewerName: "Alex", scheduledAt: new Date("2026-12-03T18:00:00Z"), durationMinutes: 30 },
  ];
  assert.deepEqual(overlappingInterviews(at, 30, "current", rows).map((row) => row.interviewId), ["other"]);
  assert.deepEqual(overlappingInterviews(new Date("2026-12-03T19:00:00Z"), 30, "current", rows), []);
});
