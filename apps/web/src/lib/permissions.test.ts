import assert from "node:assert/strict";
import { test } from "node:test";
import { can, defaultsToRecruiterOnNewJob, isRole, isTeamRole, JOB_SCOPED_PERMISSIONS, jobPermissionsFrom, removesLastAdmin, rolesWith, statusPermission, TEAM_ROLE_PRESETS, TEAM_ROLES, teamRoleForJobField } from "./permissions";

test("only admins manage users", () => {
  assert.equal(can({ role: "admin" }, "users.manage"), true);
  assert.equal(can({ role: "recruiter" }, "users.manage"), false);
  assert.equal(can({ role: "interviewer" }, "users.manage"), false);
  assert.deepEqual(rolesWith("users.manage"), ["admin"]);
});

test("admins and recruiters manage hiring; interviewers don't", () => {
  assert.equal(can({ role: "admin" }, "applications.move"), true);
  assert.equal(can({ role: "recruiter" }, "applications.move"), true);
  assert.equal(can({ role: "interviewer" }, "applications.move"), false);
  assert.deepEqual(rolesWith("applications.move"), ["admin", "head_of_talent", "ta_manager", "recruiter", "coordinator", "hiring_manager"]);
});

test("interviewers are limited to their hiring teams", () => {
  assert.equal(can({ role: "recruiter" }, "jobs.view_all"), true);
  assert.equal(can({ role: "interviewer" }, "jobs.view_all"), false);
});

test("a resolved permission set wins over the role's defaults", () => {
  assert.equal(can({ role: "interviewer", permissions: ["reports.view"] }, "reports.view"), true);
  assert.equal(can({ role: "admin", permissions: [] }, "users.manage"), false);
});

test("job-scoped permissions pass through a team role on that job only", () => {
  const actor = { role: "interviewer" as const, jobPermissions: { "job-1": ["applications.move", "users.manage"] as const } };
  assert.equal(can(actor, "applications.move", { jobId: "job-1" }), true);
  assert.equal(can(actor, "applications.move", { jobId: "job-2" }), false);
  assert.equal(can(actor, "applications.move"), false);
  // Instance-wide permissions are never granted through a job.
  assert.equal(can(actor, "users.manage", { jobId: "job-1" }), false);
});

test("hiring and rejecting need their own permissions", () => {
  assert.equal(statusPermission("hired"), "applications.hire");
  assert.equal(statusPermission("rejected"), "applications.reject");
  assert.equal(statusPermission("withdrawn"), "applications.move");
  assert.equal(statusPermission("active"), "applications.move");
});

test("recruiters default to recruiter on jobs they create; admins don't", () => {
  assert.equal(defaultsToRecruiterOnNewJob({ role: "recruiter" }), true);
  assert.equal(defaultsToRecruiterOnNewJob({ role: "admin" }), false);
  assert.equal(defaultsToRecruiterOnNewJob({ role: "interviewer" }), false);
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

test("team roles grant job-scoped permissions on that job only (#96)", () => {
  const rows = [
    { jobId: "job-hm", teamRole: "hiring_manager" as const },
    { jobId: "job-view", teamRole: "viewer" as const },
  ];
  const interviewer = { role: "interviewer" as const, jobPermissions: jobPermissionsFrom(rows) };
  // An Interviewer who is a job's hiring manager can move candidates and read every scorecard there.
  assert.equal(can(interviewer, "applications.move", { jobId: "job-hm" }), true);
  assert.equal(can(interviewer, "scorecards.view_all", { jobId: "job-hm" }), true);
  assert.equal(can(interviewer, "applications.move", { jobId: "job-view" }), false);
  assert.equal(can(interviewer, "applications.move"), false);
  // Team roles never grant pay edits to a hiring manager, or anything instance-wide.
  assert.equal(can(interviewer, "jobs.edit_compensation", { jobId: "job-hm" }), false);
  for (const role of TEAM_ROLES) {
    for (const p of TEAM_ROLE_PRESETS[role].permissions) assert.ok(JOB_SCOPED_PERMISSIONS.includes(p), `${role} ${p}`);
  }
  // An Executive placed on a job as viewer can see that job's pipeline.
  const exec = { role: "executive" as const, jobPermissions: jobPermissionsFrom([{ jobId: "j", teamRole: "viewer" }]) };
  assert.equal(can(exec, "applications.view", { jobId: "j" }), true);
  assert.equal(can(exec, "applications.view"), false);
});

test("the job form's people get matching team roles", () => {
  assert.equal(teamRoleForJobField("hiringManagerId"), "hiring_manager");
  assert.equal(teamRoleForJobField("recruiterId"), "recruiter");
  assert.equal(isTeamRole("viewer"), true);
  assert.equal(isTeamRole("owner"), false);
});
