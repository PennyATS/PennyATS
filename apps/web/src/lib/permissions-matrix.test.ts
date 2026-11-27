/**
 * Role presets against the access epic's matrix (#93, #95). Expectations are written out by
 * hand from the epic table, so a change to any preset shows up here in review.
 *
 * Column order: Admin, Head of Talent, TA Manager, Recruiter, Coordinator, Hiring Manager,
 * Interviewer, Executive. "Their jobs" / "own jobs" cells are granted as permissions and then
 * narrowed by job scoping (no `jobs.view_all`) or, for Recruiter reports, by `reports.view_all`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { SCOPE_PERMISSIONS, SCOPES, scopesFor } from "./api/scopes";
import { can, canAssignRole, PERMISSIONS, ROLES, type Permission, type Role } from "./permissions";

type Row = [Permission, ...boolean[]];
const Y = true;
const N = false;

//                                        Adm HoT TAM Rec Crd HM  Int Exe
const MATRIX: Row[] = [
  ["jobs.view",                 Y, Y, Y, Y, Y, Y, Y, Y],
  ["jobs.view_all",             Y, Y, Y, Y, Y, N, N, Y], // HM and Interviewer: their jobs
  ["jobs.create",               Y, Y, Y, Y, N, N, N, N],
  ["jobs.edit",                 Y, Y, Y, Y, N, Y, N, N], // HM: own jobs
  ["jobs.view_confidential",    Y, Y, N, N, N, N, N, N], // others: if on the team (#96)
  ["jobs.view_compensation",    Y, Y, Y, Y, N, Y, N, Y],
  ["jobs.edit_compensation",    Y, Y, Y, Y, N, N, N, N], // HM edits own jobs, not pay
  ["candidates.view",           Y, Y, Y, Y, Y, Y, Y, N], // Executive: aggregates only
  ["candidates.view_all",       Y, Y, Y, Y, Y, N, N, N],
  ["candidates.create",         Y, Y, Y, Y, Y, N, N, N],
  ["candidates.edit",           Y, Y, Y, Y, Y, N, N, N],
  ["applications.view",         Y, Y, Y, Y, Y, Y, Y, N],
  ["applications.move",         Y, Y, Y, Y, Y, Y, N, N],
  ["applications.reject",       Y, Y, Y, Y, N, Y, N, N],
  ["applications.hire",         Y, Y, Y, Y, N, Y, N, N],
  ["notes.view",                Y, Y, Y, Y, Y, Y, Y, N],
  ["notes.write",               Y, Y, Y, Y, Y, Y, Y, N],
  ["notes.phone_screen.read",   Y, Y, Y, Y, Y, Y, N, N], // #97: read and write are separate
  ["notes.phone_screen.write",  Y, Y, Y, Y, N, N, N, N], // Coordinator and HM: read only
  ["scorecards.view",           Y, Y, Y, Y, N, Y, Y, N], // Coordinator: no scorecard content
  ["scorecards.view_all",       Y, Y, Y, Y, N, Y, N, N], // Interviewer: after own submitted
  ["scorecards.submit",         Y, Y, Y, Y, N, Y, Y, N],
  ["interviews.view",           Y, Y, Y, Y, Y, Y, Y, N],
  ["interviews.schedule",       Y, Y, Y, Y, Y, N, N, N],
  ["interviews.plan",           Y, Y, Y, Y, Y, N, N, N],
  ["email.send",                Y, Y, Y, Y, Y, N, N, N],
  ["templates.view",            Y, Y, Y, Y, Y, N, N, N],
  ["templates.manage",          Y, Y, Y, Y, Y, N, N, N],
  ["reports.view",              Y, Y, Y, Y, N, Y, N, Y],
  ["reports.view_all",          Y, Y, Y, N, N, N, N, Y], // Recruiter and HM: own jobs
  ["reports.export",            Y, Y, Y, N, N, N, N, Y],
  ["dashboards.executive",      Y, Y, Y, N, N, N, N, Y],
  ["privacy.export",            Y, Y, N, N, N, N, N, N],
  ["privacy.delete",            Y, Y, N, N, N, N, N, N],
  ["users.invite",              Y, Y, Y, N, N, N, N, N],
  ["users.manage",              Y, N, N, N, N, N, N, N],
  ["roles.manage",              Y, N, N, N, N, N, N, N],
  ["settings.manage",           Y, N, N, N, N, N, N, N],
  ["audit.view",                Y, Y, N, N, N, N, N, N],
];

const ORDER: Role[] = ["admin", "head_of_talent", "ta_manager", "recruiter", "coordinator", "hiring_manager", "interviewer", "executive"];

test("the matrix lists every permission and every role once", () => {
  assert.deepEqual(MATRIX.map(([p]) => p).sort(), [...PERMISSIONS].sort());
  assert.deepEqual([...ORDER].sort(), [...ROLES].sort());
  for (const row of MATRIX) assert.equal(row.length, ORDER.length + 1, row[0]);
});

test("each role preset matches the epic matrix", () => {
  for (const [permission, ...cells] of MATRIX) {
    ORDER.forEach((role, i) => assert.equal(can({ role }, permission), cells[i], `${role} ${permission}`));
  }
});

test("migrated roles keep the access they had where the epic agrees", () => {
  // Admin keeps everything. Interviewer is unchanged. Recruiter keeps the hiring workflow;
  // per the epic it no longer gets the executive dashboard, CSV export, or all-jobs reports.
  assert.deepEqual(PERMISSIONS.filter((p) => can({ role: "admin" }, p)), [...PERMISSIONS]);
  assert.deepEqual(PERMISSIONS.filter((p) => can({ role: "interviewer" }, p)), [
    "jobs.view",
    "candidates.view",
    "applications.view",
    "notes.view",
    "notes.write",
    "scorecards.view",
    "scorecards.submit",
    "interviews.view",
  ]);
  const apiPermissions = [...new Set(SCOPES.flatMap((s) => SCOPE_PERMISSIONS[s]))];
  for (const p of apiPermissions) assert.equal(can({ role: "recruiter" }, p), p !== "privacy.delete", p);
  assert.deepEqual(scopesFor({ role: "admin" }), [...SCOPES]);
});

test("people can only hand out roles with no more access than their own", () => {
  assert.ok(ROLES.every((r) => canAssignRole({ role: "admin" }, r)));
  assert.equal(canAssignRole({ role: "head_of_talent" }, "admin"), false);
  assert.equal(canAssignRole({ role: "head_of_talent" }, "ta_manager"), true);
  assert.equal(canAssignRole({ role: "ta_manager" }, "head_of_talent"), false);
  assert.equal(canAssignRole({ role: "ta_manager" }, "recruiter"), true);
  assert.equal(canAssignRole({ role: "ta_manager" }, "executive"), true);
  assert.equal(canAssignRole({ role: "recruiter" }, "interviewer"), false);
});
