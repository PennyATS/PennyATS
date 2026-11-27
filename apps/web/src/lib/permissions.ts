/**
 * Access rules in one place (#94). Pure functions so they are easy to test.
 *
 * Access is checked by named permission with `can(user, permission)`, never by role name.
 * Roles are bundles of permissions. Today there are three:
 *
 * admin        everything, including users, settings, and privacy actions
 * recruiter    the hiring workflow on every job
 * interviewer  jobs they are on the hiring team for: view, notes, interviews, own scorecards
 *
 * Job scoping (which jobs a user can see) is applied separately by `visibleJobIds`,
 * `canSeeJob`, and `canSeeCandidate` in `lib/hiring.ts`.
 */
export type Role = "admin" | "recruiter" | "interviewer";

export const ROLES: readonly Role[] = ["admin", "recruiter", "interviewer"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Every permission, grouped by area. The API's scopes map onto these in `lib/api/scopes.ts`. */
export const PERMISSION_GROUPS = {
  Jobs: [
    "jobs.view",
    "jobs.view_all",
    "jobs.create",
    "jobs.edit",
    "jobs.view_confidential",
    "jobs.view_compensation",
  ],
  Candidates: ["candidates.view", "candidates.view_all", "candidates.create", "candidates.edit"],
  Applications: ["applications.view", "applications.move", "applications.reject", "applications.hire"],
  Notes: ["notes.view", "notes.write", "notes.phone_screen.write"],
  Scorecards: ["scorecards.view", "scorecards.view_all", "scorecards.submit"],
  Interviews: ["interviews.view", "interviews.schedule", "interviews.plan"],
  Email: ["email.send", "templates.view", "templates.manage"],
  Reports: ["reports.view", "reports.export", "dashboards.executive"],
  Privacy: ["privacy.export", "privacy.delete"],
  Administration: ["users.invite", "users.manage", "roles.manage", "settings.manage", "audit.view"],
} as const;

export type Permission = (typeof PERMISSION_GROUPS)[keyof typeof PERMISSION_GROUPS][number];

export const PERMISSIONS: readonly Permission[] = Object.values(PERMISSION_GROUPS).flat();

export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Permissions that only apply to a job (moving its candidates, reading its scorecards).
 * Being on that job's hiring team with a team role that grants one is enough (#96).
 */
export const JOB_SCOPED_PERMISSIONS: readonly Permission[] = [
  "jobs.edit",
  "jobs.view_compensation",
  "applications.move",
  "applications.reject",
  "applications.hire",
  "scorecards.view_all",
  "notes.phone_screen.write",
  "interviews.schedule",
  "interviews.plan",
  "email.send",
  "reports.view",
];

/** Everyone signed in. Which jobs they see is decided by job scoping, not by these. */
const MEMBER: readonly Permission[] = [
  "jobs.view",
  "candidates.view",
  "applications.view",
  "notes.view",
  "notes.write",
  "scorecards.view",
  "scorecards.submit",
  "interviews.view",
];

const HIRING: readonly Permission[] = [
  ...MEMBER,
  "jobs.view_all",
  "jobs.create",
  "jobs.edit",
  "jobs.view_compensation",
  "candidates.view_all",
  "candidates.create",
  "candidates.edit",
  "applications.move",
  "applications.reject",
  "applications.hire",
  "notes.phone_screen.write",
  "scorecards.view_all",
  "interviews.schedule",
  "interviews.plan",
  "email.send",
  "templates.view",
  "templates.manage",
  "reports.view",
  "reports.export",
  "dashboards.executive",
];

/** Each role's permissions. Behavior matches the role checks used before #94 exactly. */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  admin: PERMISSIONS,
  recruiter: PERMISSIONS.filter((p) => HIRING.includes(p)),
  interviewer: PERMISSIONS.filter((p) => MEMBER.includes(p)),
};

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}

/** Anyone `can()` accepts: a session user, an API key's user, or just a role. */
export type Actor = {
  role: Role;
  /** Resolved once when the user is loaded, so checks don't re-query. Falls back to the role's set. */
  permissions?: readonly Permission[];
  /** Extra permissions on specific jobs, from hiring team roles (#96). Keyed by job id. */
  jobPermissions?: Readonly<Record<string, readonly Permission[]>>;
};

/**
 * The single access check. `jobId` lets a job-scoped permission pass through the user's
 * team role on that job, even when their own role doesn't grant it.
 */
export function can(actor: Actor, permission: Permission, opts?: { jobId?: string | null }): boolean {
  const own = actor.permissions ?? ROLE_PERMISSIONS[actor.role];
  if (own.includes(permission)) return true;
  if (!opts?.jobId || !JOB_SCOPED_PERMISSIONS.includes(permission)) return false;
  return actor.jobPermissions?.[opts.jobId]?.includes(permission) ?? false;
}

/** Roles whose permission set includes `permission`, for queries such as "who gets notified". */
export function rolesWith(permission: Permission): Role[] {
  return ROLES.filter((role) => ROLE_PERMISSIONS[role].includes(permission));
}

/** People who don't manage users default to recruiter on jobs they create. */
export function defaultsToRecruiterOnNewJob(actor: Actor): boolean {
  return can(actor, "jobs.create") && !can(actor, "users.manage");
}

/** Keep at least one active user who can manage users and roles. */
export function removesLastAdmin(input: {
  currentRole: Role;
  currentActive: boolean;
  nextRole: Role;
  nextActive: boolean;
  activeAdminCount: number;
}): boolean {
  const manages = (role: Role) => can({ role }, "users.manage");
  return manages(input.currentRole) && input.currentActive &&
    (!manages(input.nextRole) || !input.nextActive) && input.activeAdminCount <= 1;
}

/** The permission behind each application status change: hiring and rejecting are separate from moving. */
export function statusPermission(status: "hired" | "rejected" | "withdrawn" | "active"): Permission {
  return status === "hired" ? "applications.hire" : status === "rejected" ? "applications.reject" : "applications.move";
}
