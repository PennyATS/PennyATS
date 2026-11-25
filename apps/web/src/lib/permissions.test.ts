import assert from "node:assert/strict";
import { test } from "node:test";
import { canManageHiring, canManageUsers, isRole, seesAllJobs } from "./permissions";

test("only admins manage users", () => {
  assert.equal(canManageUsers("admin"), true);
  assert.equal(canManageUsers("recruiter"), false);
  assert.equal(canManageUsers("interviewer"), false);
});

test("admins and recruiters manage hiring; interviewers don't", () => {
  assert.equal(canManageHiring("admin"), true);
  assert.equal(canManageHiring("recruiter"), true);
  assert.equal(canManageHiring("interviewer"), false);
});

test("interviewers are limited to their hiring teams", () => {
  assert.equal(seesAllJobs("recruiter"), true);
  assert.equal(seesAllJobs("interviewer"), false);
});

test("isRole rejects anything that isn't a known role", () => {
  assert.equal(isRole("recruiter"), true);
  assert.equal(isRole("owner"), false);
  assert.equal(isRole(null), false);
});
