/**
 * Snapshot of the role x permission matrix before the permission model (#94).
 * Each existing role's access must stay identical across the change, so these values are
 * written out by hand rather than computed from the code under test.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { roleHasPermission, PERMISSIONS as API_PERMISSIONS } from "./api/scopes";
import { canManageHiring, canManageUsers, ROLES, seesAllJobs, type Role } from "./permissions";

/** The three checks the UI used before #94. */
export const LEGACY_UI: Record<Role, { manageUsers: boolean; manageHiring: boolean; seesAllJobs: boolean }> = {
  admin: { manageUsers: true, manageHiring: true, seesAllJobs: true },
  recruiter: { manageUsers: false, manageHiring: true, seesAllJobs: true },
  interviewer: { manageUsers: false, manageHiring: false, seesAllJobs: false },
};

/** What the API allowed each role before #94. */
export const LEGACY_API: Record<Role, readonly string[]> = {
  admin: [...API_PERMISSIONS],
  recruiter: API_PERMISSIONS.filter((p) => p !== "privacy.delete"),
  interviewer: [
    "jobs.view",
    "candidates.view",
    "applications.view",
    "scorecards.view",
    "scorecards.submit",
    "notes.view",
    "notes.write",
    "interviews.view",
  ],
};

test("UI role checks match the snapshot", () => {
  for (const role of ROLES) {
    assert.deepEqual(
      { manageUsers: canManageUsers(role), manageHiring: canManageHiring(role), seesAllJobs: seesAllJobs(role) },
      LEGACY_UI[role],
      role,
    );
  }
});

test("API role permissions match the snapshot", () => {
  for (const role of ROLES) {
    assert.deepEqual(API_PERMISSIONS.filter((p) => roleHasPermission(role, p)), [...LEGACY_API[role]], role);
  }
});
