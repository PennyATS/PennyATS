import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SETUP_STEPS,
  checklistSteps,
  checklistSummary,
  readChecklistState,
  showChecklistOnHome,
  skipStep,
  testMessage,
  unskipStep,
  type SetupFacts,
} from "./setup-checklist";

const none: SetupFacts = { company: false, job: false, email: false, calendar: false, ai: false, team: false };
const all: SetupFacts = { company: true, job: true, email: true, calendar: true, ai: true, team: true };

test("steps follow the order in the issue, with calendar and AI optional", () => {
  assert.deepEqual(SETUP_STEPS.map((s) => s.id), ["company", "job", "email", "calendar", "ai", "team"]);
  assert.deepEqual(SETUP_STEPS.filter((s) => s.optional).map((s) => s.id), ["calendar", "ai"]);
  assert.deepEqual(SETUP_STEPS.filter((s) => s.testable).map((s) => s.id), ["email", "calendar", "ai"]);
});

test("technical terms are explained where they appear", () => {
  const email = SETUP_STEPS.find((s) => s.id === "email")!;
  const calendar = SETUP_STEPS.find((s) => s.id === "calendar")!;
  assert.match(email.how, /SMTP is the standard way/);
  assert.match(calendar.how, /OAuth, which means/);
});

test("done comes from the workspace; skipped and to do from the stored state", () => {
  const state = skipStep(readChecklistState(null), "calendar");
  const steps = checklistSteps({ ...none, job: true }, state);
  const status = Object.fromEntries(steps.map((s) => [s.id, s.status]));
  assert.equal(status.job, "done");
  assert.equal(status.calendar, "skipped");
  assert.equal(status.email, "todo");
  // Doing a skipped step marks it done.
  assert.equal(checklistSteps({ ...none, calendar: true }, state).find((s) => s.id === "calendar")!.status, "done");
});

test("skips can be undone and are stored once", () => {
  let state = readChecklistState(undefined);
  state = skipStep(skipStep(state, "ai"), "ai");
  assert.deepEqual(state.skipped, ["ai"]);
  assert.deepEqual(unskipStep(state, "ai").skipped, []);
});

test("stored state is parsed defensively", () => {
  assert.deepEqual(readChecklistState({ skipped: ["ai", "bogus", "ai", 3], dismissed: "yes" }), { skipped: ["ai"], dismissed: false });
  assert.deepEqual(readChecklistState("junk"), { skipped: [], dismissed: false });
});

test("Home shows the checklist to admins until finished or hidden", () => {
  const fresh = readChecklistState(null);
  const todo = checklistSteps(none, fresh);
  assert.equal(showChecklistOnHome(true, todo, fresh), true);
  assert.equal(showChecklistOnHome(false, todo, fresh), false);
  assert.equal(showChecklistOnHome(true, todo, { ...fresh, dismissed: true }), false);
  assert.equal(showChecklistOnHome(true, checklistSteps(all, fresh), fresh), false);
  const skippedAll = SETUP_STEPS.reduce((s, step) => skipStep(s, step.id), fresh);
  assert.equal(checklistSummary(checklistSteps(none, skippedAll)).finished, true);
});

test("test results are plain language", () => {
  assert.equal(testMessage("email", "ok").ok, true);
  assert.match(testMessage("email", "not_configured").text, /not set up yet/);
  assert.match(testMessage("calendar", "not_connected").text, /click Connect/);
  assert.match(testMessage("ai", "not_configured").text, /everything else works without it/);
  // An outcome without its own wording falls back to the step's failure message.
  assert.equal(testMessage("email", "rate_limited").text, testMessage("email", "failed").text);
  for (const step of ["email", "calendar", "ai"] as const) {
    assert.doesNotMatch(testMessage(step, "failed").text, /ECONN|ETIMEDOUT|status \d/);
  }
});
