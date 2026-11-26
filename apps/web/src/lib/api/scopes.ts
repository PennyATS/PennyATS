/**
 * API key scopes and the permission each API action needs. Pure, so it is unit tested.
 *
 * A request is allowed only when both hold:
 *   1. the key has the route's scope, and
 *   2. the user the key acts as has the route's permission.
 *
 * Permission names follow the named-permission model planned in #94. Until that ships,
 * `roleHasPermission` maps today's three roles onto them, matching the UI's role checks
 * (canManageHiring, canManageUsers). When #94 lands, swap it for `can(user, permission)`.
 */
import type { Role } from "../permissions";

export const SCOPES = [
  "jobs:read",
  "jobs:write",
  "stages:read",
  "stages:write",
  "candidates:read",
  "candidates:write",
  "candidates:delete",
  "applications:read",
  "applications:write",
  "scorecards:read",
  "scorecards:write",
  "notes:read",
  "notes:write",
  "tags:read",
  "tags:write",
  "interviews:read",
  "interviews:write",
  "reports:read",
  "templates:read",
  "emails:send",
] as const;
export type Scope = (typeof SCOPES)[number];

export const READ_SCOPES: readonly Scope[] = SCOPES.filter((s) => s.endsWith(":read"));

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  "jobs:read": "List and view jobs the key's user can see",
  "jobs:write": "Create and edit jobs",
  "stages:read": "View a job's pipeline stages",
  "stages:write": "Add pipeline stages",
  "candidates:read": "Search and view candidates",
  "candidates:write": "Add candidates",
  "candidates:delete": "Permanently delete candidates (admin keys only)",
  "applications:read": "List and view applications",
  "applications:write": "Add applications, move stages, hire, reject, withdraw, reopen",
  "scorecards:read": "Read scorecards (hidden until the key's user submits their own, as in the app)",
  "scorecards:write": "Submit scorecards as the key's user",
  "notes:read": "Read candidate notes",
  "notes:write": "Add candidate notes",
  "tags:read": "Read candidate tags",
  "tags:write": "Add and remove candidate tags",
  "interviews:read": "View interviews",
  "interviews:write": "Add interviews",
  "reports:read": "Run reports",
  "templates:read": "List email templates and draft emails from them",
  "emails:send": "Send template emails to candidates",
};

export function isScope(value: unknown): value is Scope {
  return typeof value === "string" && (SCOPES as readonly string[]).includes(value);
}

/** Valid, de-duplicated scopes in canonical order. */
export function normalizeScopes(values: readonly unknown[]): Scope[] {
  const set = new Set(values.filter(isScope));
  return SCOPES.filter((s) => set.has(s));
}

/** Permission names used by API routes. A subset of the #94 list, plus view and submit permissions. */
export const PERMISSIONS = [
  "jobs.view",
  "jobs.create",
  "jobs.edit",
  "candidates.view",
  "candidates.create",
  "candidates.edit",
  "privacy.delete",
  "applications.view",
  "applications.move",
  "scorecards.view",
  "scorecards.submit",
  "notes.view",
  "notes.write",
  "interviews.view",
  "interviews.schedule",
  "reports.view",
  "templates.view",
  "email.send",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** What everyone signed in can do. Visibility (which jobs) is applied separately. */
const EVERYONE: readonly Permission[] = [
  "jobs.view",
  "candidates.view",
  "applications.view",
  "scorecards.view",
  "scorecards.submit",
  "notes.view",
  "notes.write",
  "interviews.view",
];

/** Same split as the UI: admins everything, recruiters hiring work, interviewers read and give feedback. */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  if (role === "admin") return true;
  if (role === "recruiter") return permission !== "privacy.delete";
  return EVERYONE.includes(permission);
}

/** Scopes a key can usefully hold for a role. Anything else would always be denied. */
export function scopesForRole(role: Role): Scope[] {
  return SCOPES.filter((scope) => {
    const needed = SCOPE_PERMISSIONS[scope];
    return needed.some((p) => roleHasPermission(role, p));
  });
}

/** The permissions behind each scope, for the docs and for #94. */
export const SCOPE_PERMISSIONS: Record<Scope, readonly Permission[]> = {
  "jobs:read": ["jobs.view"],
  "jobs:write": ["jobs.create", "jobs.edit"],
  "stages:read": ["jobs.view"],
  "stages:write": ["jobs.edit"],
  "candidates:read": ["candidates.view"],
  "candidates:write": ["candidates.create"],
  "candidates:delete": ["privacy.delete"],
  "applications:read": ["applications.view"],
  "applications:write": ["applications.move"],
  "scorecards:read": ["scorecards.view"],
  "scorecards:write": ["scorecards.submit"],
  "notes:read": ["notes.view"],
  "notes:write": ["notes.write"],
  "tags:read": ["candidates.view"],
  "tags:write": ["candidates.edit"],
  "interviews:read": ["interviews.view"],
  "interviews:write": ["interviews.schedule"],
  "reports:read": ["reports.view"],
  "templates:read": ["templates.view"],
  "emails:send": ["email.send"],
};

export type AccessDecision = { ok: true } | { ok: false; code: "missing_scope" | "forbidden"; message: string };

/** The check every API route runs before its handler. */
export function checkAccess(input: { scopes: readonly string[]; role: Role }, need: { scope: Scope; permission: Permission }): AccessDecision {
  if (!input.scopes.includes(need.scope)) {
    return { ok: false, code: "missing_scope", message: `This API key needs the ${need.scope} scope.` };
  }
  if (!roleHasPermission(input.role, need.permission)) {
    return { ok: false, code: "forbidden", message: `The key's user (${input.role}) does not have the ${need.permission} permission.` };
  }
  return { ok: true };
}
