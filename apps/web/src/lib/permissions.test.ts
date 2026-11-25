import assert from "node:assert/strict";
import { test } from "node:test";
import { canManageHiring, canManageUsers, isRole, removesLastAdmin, seesAllJobs } from "./permissions";

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

test("the last active admin cannot be demoted or deactivated", () => {
  const current = { currentRole: "admin" as const, currentActive: true, activeAdminCount: 1 };
  assert.equal(removesLastAdmin({ ...current, nextRole: "recruiter", nextActive: true }), true);
  assert.equal(removesLastAdmin({ ...current, nextRole: "admin", nextActive: false }), true);
  assert.equal(removesLastAdmin({ ...current, nextRole: "admin", nextActive: true }), false);
  assert.equal(removesLastAdmin({ ...current, activeAdminCount: 2, nextRole: "interviewer", nextActive: true }), false);
  assert.equal(removesLastAdmin({ ...current, activeAdminCount: 2, nextRole: "admin", nextActive: false }), false);
  assert.equal(removesLastAdmin({ currentRole: "recruiter", currentActive: true, activeAdminCount: 1, nextRole: "interviewer", nextActive: false }), false);
});
