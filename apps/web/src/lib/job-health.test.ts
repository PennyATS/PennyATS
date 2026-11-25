import assert from "node:assert/strict";
import { test } from "node:test";
import { daysSince, jobHealth, weeklyApplicants, type HealthApp, type HealthInput } from "./job-health";

const NOW = new Date(Date.UTC(2026, 10, 24));
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const STAGES = [
  { id: "applied", name: "Applied", position: 0 },
  { id: "screen", name: "Screen", position: 1 },
  { id: "onsite", name: "Onsite", position: 2 },
];

function app(id: string, over: Partial<HealthApp> = {}): HealthApp {
  return {
    id,
    candidateId: `c-${id}`,
    name: `Person ${id}`,
    status: "active",
    stageId: "applied",
    appliedAt: daysAgo(2),
    stageChangedAt: daysAgo(2),
    ...over,
  };
}

const base = (over: Partial<HealthInput> = {}): HealthInput => ({
  jobStatus: "open",
  apps: [app("a")],
  stages: STAGES,
  scorecards: [],
  teamSize: 2,
  now: NOW,
  ...over,
});

const ids = (input: HealthInput) => jobHealth(input).map((c) => c.id);

test("a healthy job has no checks", () => {
  assert.deepEqual(ids(base()), []);
});

test("candidates with no movement for more than 14 days are stuck", () => {
  const checks = jobHealth(base({ apps: [app("a", { stageChangedAt: daysAgo(15) }), app("b", { stageChangedAt: daysAgo(14) })] }));
  const stuck = checks.find((c) => c.id === "stuck");
  assert.deepEqual(stuck?.candidates, [{ id: "c-a", name: "Person a" }]);
  assert.equal(stuck?.title, "1 candidate stuck in a stage");
});

test("closed applications are never stuck or waiting on feedback", () => {
  const old = { stageId: "onsite", stageChangedAt: daysAgo(30) };
  assert.deepEqual(ids(base({ apps: [app("a", { ...old, status: "rejected" }), app("n")] })), []);
});

test("feedback is due past the first stage after 3 days without a scorecard for that stage", () => {
  const waiting = app("a", { stageId: "screen", stageChangedAt: daysAgo(4) });
  assert.ok(ids(base({ apps: [waiting] })).includes("feedback"));
  // A scorecard filed under the current stage clears it; one for an earlier stage doesn't.
  assert.ok(!ids(base({ apps: [waiting], scorecards: [{ applicationId: "a", stageName: "Screen" }] })).includes("feedback"));
  assert.ok(ids(base({ apps: [waiting], scorecards: [{ applicationId: "a", stageName: "Applied" }] })).includes("feedback"));
  // Too soon, or still in the first stage: not flagged.
  assert.ok(!ids(base({ apps: [app("b", { stageId: "screen", stageChangedAt: daysAgo(2) })] })).includes("feedback"));
  assert.ok(!ids(base({ apps: [app("c", { stageId: "applied", stageChangedAt: daysAgo(10) })] })).includes("feedback"));
});

test("a stage holding 40%+ of at least 3 active candidates is a bottleneck", () => {
  const apps = [
    app("1", { stageId: "screen" }),
    app("2", { stageId: "screen" }),
    app("3", { stageId: "screen" }),
    app("4"),
    app("5"),
  ];
  const checks = jobHealth(base({ apps, scorecards: apps.map((a) => ({ applicationId: a.id, stageName: "Screen" })) }));
  const bottlenecks = checks.filter((c) => c.id === "bottleneck");
  assert.deepEqual(bottlenecks.map((c) => c.title), ["Screen is a bottleneck"]);
  assert.equal(bottlenecks[0].detail, "3 of 5 active candidates are waiting here.");
  // Two candidates in a stage is never a bottleneck, however small the job.
  assert.ok(!ids(base({ apps: [app("1", { stageId: "screen" }), app("2", { stageId: "screen" })] })).includes("bottleneck"));
});

test("open jobs with no applicants for 14+ days are flagged; drafts and closed jobs aren't", () => {
  assert.ok(ids(base({ apps: [] })).includes("quiet"));
  assert.ok(ids(base({ apps: [app("a", { appliedAt: daysAgo(20), stageChangedAt: daysAgo(1) })] })).includes("quiet"));
  assert.ok(!ids(base({ jobStatus: "closed", apps: [] })).includes("quiet"));
  assert.deepEqual(ids(base({ jobStatus: "draft", apps: [] })), ["draft"]);
});

test("a job with no hiring team gets an informational check", () => {
  const team = jobHealth(base({ teamSize: 0 })).find((c) => c.id === "team");
  assert.equal(team?.level, "info");
});

test("weeklyApplicants buckets the last N weeks, oldest first", () => {
  const weeks = weeklyApplicants([{ appliedAt: daysAgo(1) }, { appliedAt: daysAgo(6) }, { appliedAt: daysAgo(8) }, { appliedAt: daysAgo(60) }], 4, NOW);
  assert.deepEqual(weeks.map((w) => w.count), [0, 0, 1, 2]);
  assert.equal(weeks[0].start.toISOString(), daysAgo(28).toISOString());
});

test("daysSince never goes negative", () => {
  assert.equal(daysSince(daysAgo(3.5), NOW), 3);
  assert.equal(daysSince(new Date(NOW.getTime() + 1000), NOW), 0);
});

test("overdue interview feedback names who it's waiting on, and replaces the stage-level guess", () => {
  const waiting = app("a", { stageId: "screen", stageChangedAt: daysAgo(5) });
  const checks = jobHealth(
    base({
      apps: [waiting],
      overdueInterviews: [{ candidateId: "c-a", name: "Person a", interview: "Screen call", missing: ["Ana"] }],
      appsWithInterviews: ["a"],
    }),
  );
  const interviews = checks.find((c) => c.id === "interviews");
  assert.equal(interviews?.title, "1 interview with overdue feedback");
  assert.equal(interviews?.detail, "Person a, Screen call: waiting on Ana.");
  // The candidate's stage has an interview, so the generic feedback check stays quiet.
  assert.ok(!checks.some((c) => c.id === "feedback"));
});
