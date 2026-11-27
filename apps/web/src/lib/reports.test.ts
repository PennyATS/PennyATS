import assert from "node:assert/strict";
import { test } from "node:test";
import {
  daysToHire,
  formatDays,
  funnel,
  median,
  monthlyTrend,
  periodStart,
  readPeriod,
  rejectionReasons,
  reportTables,
  sources,
  stageTimeline,
  summarizeJob,
  timeInStage,
  type ReportApp,
  type ReportEvent,
  type ReportStage,
} from "./reports";

const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n));

const STAGES: ReportStage[] = [
  { id: "s-applied", jobId: "j", name: "Applied", position: 0 },
  { id: "s-screen", jobId: "j", name: "Screen", position: 1 },
  { id: "s-onsite", jobId: "j", name: "Onsite", position: 2 },
];

function app(id: string, over: Partial<ReportApp> = {}): ReportApp {
  return {
    id,
    jobId: "j",
    status: "active",
    source: "Careers page",
    appliedAt: day(0),
    stageId: "s-applied",
    rejectionReason: null,
    ...over,
  };
}
const move = (applicationId: string, from: string, to: string, at: number): ReportEvent => ({
  applicationId,
  type: "stage_changed",
  data: { from, to },
  createdAt: day(at),
});
const close = (applicationId: string, type: string, at: number): ReportEvent => ({
  applicationId,
  type,
  data: {},
  createdAt: day(at),
});

// a: applied day 0 -> screen day 2 -> onsite day 5 -> hired day 9
// b: applied day 0 -> screen day 4 -> rejected day 6
// c: applied day 1, still in Applied
const APPS = [
  app("a", { status: "hired", stageId: "s-onsite", source: "Referral" }),
  app("b", { status: "rejected", stageId: "s-screen", rejectionReason: "Not enough experience" }),
  app("c", { appliedAt: day(1) }),
];
const EVENTS = [
  move("a", "s-applied", "s-screen", 2),
  move("a", "s-screen", "s-onsite", 5),
  close("a", "hired", 9),
  move("b", "s-applied", "s-screen", 4),
  close("b", "rejected", 6),
];

test("median and day formatting", () => {
  assert.equal(median([]), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(formatDays(null), "-");
  assert.equal(formatDays(0.4), "under a day");
  assert.equal(formatDays(1), "1 day");
  assert.equal(formatDays(3.25), "3.3 days");
});

test("stageTimeline follows moves and ends at the closing event", () => {
  assert.deepEqual(
    stageTimeline(APPS[0], EVENTS.filter((e) => e.applicationId === "a")),
    [
      { stageId: "s-applied", start: day(0), end: day(2) },
      { stageId: "s-screen", start: day(2), end: day(5) },
      { stageId: "s-onsite", start: day(5), end: day(9) },
    ],
  );
  // Still active and never moved: one open segment in the current stage.
  assert.deepEqual(stageTimeline(APPS[2], []), [{ stageId: "s-applied", start: day(1), end: null }]);
});

test("funnel counts applicants who reached each stage or later, plus hires", () => {
  assert.deepEqual(funnel(STAGES, APPS, EVENTS), [
    { label: "Applied", count: 3, percent: 100 },
    { label: "Screen", count: 2, percent: 67 },
    { label: "Onsite", count: 1, percent: 33 },
    { label: "Hired", count: 1, percent: 33 },
  ]);
});

test("a hire counts through every stage even if stages were skipped", () => {
  const skipped = [app("x", { status: "hired", stageId: "s-applied" })];
  const rows = funnel(STAGES, skipped, [close("x", "hired", 3)]);
  assert.deepEqual(rows.map((r) => r.count), [1, 1, 1, 1]);
});

test("timeInStage only uses completed stays, in stage order", () => {
  assert.deepEqual(timeInStage(STAGES, APPS, EVENTS), [
    { stage: "Applied", samples: 2, averageDays: 3, medianDays: 3 }, // a: 2 days, b: 4 days
    { stage: "Screen", samples: 2, averageDays: 2.5, medianDays: 2.5 }, // a: 3 days, b: 2 days
    { stage: "Onsite", samples: 1, averageDays: 4, medianDays: 4 }, // a: 4 days
  ]);
});

test("daysToHire and the job summary", () => {
  assert.deepEqual(daysToHire(APPS, EVENTS), [9]);
  assert.deepEqual(summarizeJob(APPS, EVENTS), {
    applicants: 3,
    active: 1,
    hired: 1,
    rejected: 1,
    withdrawn: 0,
    medianDaysToHire: 9,
  });
});

test("sources count applicants, those who advanced, and hires", () => {
  assert.deepEqual(sources(APPS, EVENTS), [
    { source: "Careers page", applicants: 2, advanced: 1, hired: 0 },
    { source: "Referral", applicants: 1, advanced: 1, hired: 1 },
  ]);
  assert.equal(sources([app("n", { source: null })], [])[0].source, "Unknown");
});

test("rejection reasons group case-insensitively", () => {
  const rejected = [
    app("1", { status: "rejected", rejectionReason: "Salary" }),
    app("2", { status: "rejected", rejectionReason: " salary " }),
    app("3", { status: "rejected" }),
    app("4", { status: "active", rejectionReason: "ignored" }),
  ];
  assert.deepEqual(rejectionReasons(rejected), [
    { reason: "Salary", count: 2 },
    { reason: "No reason given", count: 1 },
  ]);
});

test("periods default to 90 days and 'all' means no start date", () => {
  assert.equal(readPeriod(undefined), "90");
  assert.equal(readPeriod("bogus"), "90");
  assert.equal(periodStart("all"), null);
  assert.equal(periodStart("30", day(30))?.toISOString(), day(0).toISOString());
});

test("reportTables builds the funnel for one job and the per-job table for all", () => {
  const base = {
    jobs: [{ id: "j", title: "Engineer", location: "Remote", status: "open" }],
    apps: APPS,
    events: EVENTS,
    stages: STAGES,
    applyFunnel: { views: 50, starts: 20, submits: 5 },
  };
  const one = reportTables({ ...base, jobId: "j", cards: [] });
  assert.deepEqual(one.funnel?.rows, [["Applied", 3, 100], ["Screen", 2, 67], ["Onsite", 1, 33], ["Hired", 1, 33]]);
  assert.equal(one.jobs, undefined);
  assert.deepEqual(one.apply?.rows, [["Views", 50, 100], ["Starts", 20, 40], ["Submits", 5, 10]]);

  const all = reportTables({ ...base, jobId: null, cards: [{ author: "Sam", recommendation: "yes" }, { author: "Sam", recommendation: "no" }] });
  assert.equal(all.funnel, undefined);
  assert.deepEqual(all.jobs?.rows, [["Engineer · Remote", 3, 1, 1, 1, 0, 9]]);
  assert.deepEqual(all.jobIds, ["j"]);
  assert.deepEqual(all.interviewers?.rows, [["Sam", 2, 0, 1, 1, 0]]);
  assert.deepEqual(all.stages?.rows[0], ["Applied", 2, 3, 3]);
  assert.deepEqual(all.apply?.rows, [["Views", 50, 100], ["Starts", 20, 40], ["Submits", 5, 10]]);
});

test("monthlyTrend counts applications and hires per month without gaps", () => {
  const apps = [
    app("a", { appliedAt: new Date(Date.UTC(2026, 0, 5)) }),
    app("b", { appliedAt: new Date(Date.UTC(2026, 2, 9)), status: "hired" }),
  ];
  const events = [{ applicationId: "b", type: "hired", data: {}, createdAt: new Date(Date.UTC(2026, 3, 1)) }];
  assert.deepEqual(monthlyTrend(apps, events), [
    { month: "2026-01", applications: 1, hires: 0 },
    { month: "2026-02", applications: 0, hires: 0 },
    { month: "2026-03", applications: 1, hires: 0 },
    { month: "2026-04", applications: 0, hires: 1 },
  ]);
  assert.deepEqual(monthlyTrend([], []), []);
});
