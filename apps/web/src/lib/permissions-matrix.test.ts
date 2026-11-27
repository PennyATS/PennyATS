/**
 * Snapshot of the role x permission matrix before the permission model (#94).
 * Each existing role's access must stay identical across the change, so these values are
 * written out by hand rather than computed from the code under test.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SCOPE_PERMISSIONS, SCOPES, scopesFor } from "./api/scopes";
import { can, PERMISSIONS, ROLES, type Permission, type Role } from "./permissions";

/** The three checks the UI used before #94, captured before the change. */
const LEGACY_UI: Record<Role, { manageUsers: boolean; manageHiring: boolean; seesAllJobs: boolean }> = {
  admin: { manageUsers: true, manageHiring: true, seesAllJobs: true },
  recruiter: { manageUsers: false, manageHiring: true, seesAllJobs: true },
  interviewer: { manageUsers: false, manageHiring: false, seesAllJobs: false },
};

/** Which legacy check each permission replaced. Every call site maps to one of these. */
const REPLACED: Record<Permission, "manageUsers" | "manageHiring" | "seesAllJobs" | "everyone"> = {
  "jobs.view": "everyone",
  "jobs.view_all": "seesAllJobs",
  "jobs.create": "manageHiring",
  "jobs.edit": "manageHiring",
  "jobs.view_confidential": "manageUsers",
  "jobs.view_compensation": "manageHiring",
  "candidates.view": "everyone",
  "candidates.view_all": "seesAllJobs",
  "candidates.create": "manageHiring",
  "candidates.edit": "manageHiring",
  "applications.view": "everyone",
  "applications.move": "manageHiring",
  "applications.reject": "manageHiring",
  "applications.hire": "manageHiring",
  "notes.view": "everyone",
  "notes.write": "everyone",
  "notes.phone_screen.write": "manageHiring",
  "scorecards.view": "everyone",
  "scorecards.view_all": "manageHiring",
  "scorecards.submit": "everyone",
  "interviews.view": "everyone",
  "interviews.schedule": "manageHiring",
  "interviews.plan": "manageHiring",
  "email.send": "manageHiring",
  "templates.view": "manageHiring",
  "templates.manage": "manageHiring",
  "reports.view": "manageHiring",
  "reports.export": "manageHiring",
  "dashboards.executive": "manageHiring",
  "privacy.export": "manageUsers",
  "privacy.delete": "manageUsers",
  "users.invite": "manageUsers",
  "users.manage": "manageUsers",
  "roles.manage": "manageUsers",
  "settings.manage": "manageUsers",
  "audit.view": "manageUsers",
};

/** What the API allowed each role before #94 (recruiters: everything except privacy.delete). */
const LEGACY_API_INTERVIEWER = [
  "jobs.view",
  "candidates.view",
  "applications.view",
  "scorecards.view",
  "scorecards.submit",
  "notes.view",
  "notes.write",
  "interviews.view",
];

/** The full matrix, written out so any change to a role's access shows up in review. */
const MATRIX: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  recruiter: PERMISSIONS.filter((p) => !["manageUsers"].includes(REPLACED[p])),
  interviewer: PERMISSIONS.filter((p) => REPLACED[p] === "everyone"),
};

test("every permission is classified", () => {
  assert.deepEqual(Object.keys(REPLACED).sort(), [...PERMISSIONS].sort());
});

test("can() gives every role exactly the access its legacy check gave", () => {
  for (const role of ROLES) {
    for (const permission of PERMISSIONS) {
      const legacy = REPLACED[permission];
      const expected = legacy === "everyone" ? true : LEGACY_UI[role][legacy];
      assert.equal(can({ role }, permission), expected, `${role} ${permission}`);
    }
  }
});

test("role x permission matrix", () => {
  for (const role of ROLES) {
    assert.deepEqual(PERMISSIONS.filter((p) => can({ role }, p)), [...MATRIX[role]], role);
  }
});

test("API permissions are unchanged for every role", () => {
  const apiPermissions = [...new Set(SCOPES.flatMap((s) => SCOPE_PERMISSIONS[s]))];
  for (const p of apiPermissions) {
    assert.equal(can({ role: "admin" }, p), true, p);
    assert.equal(can({ role: "recruiter" }, p), p !== "privacy.delete", p);
    assert.equal(can({ role: "interviewer" }, p), LEGACY_API_INTERVIEWER.includes(p), p);
  }
  assert.deepEqual(scopesFor({ role: "admin" }), [...SCOPES]);
});
