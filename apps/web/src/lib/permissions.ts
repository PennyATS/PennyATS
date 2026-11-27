/**
 * Access rules in one place (#94, #95). Pure functions so they are easy to test.
 *
 * Access is checked by named permission with `can(user, permission)`, never by role name.
 * Roles are bundles of permissions. The system presets below ship with the app; their
 * permissions come from this file (so upgrades can adjust them), and each user's role is a
 * row in the `roles` table that points at a preset by `key`.
 *
 * Job scoping (which jobs a user can see) is applied separately by `visibleJobIds`,
 * `canSeeJob`, and `canSeeCandidate` in `lib/hiring.ts`. Roles without `jobs.view_all`
 * (Hiring Manager, Interviewer) only see jobs they are on the hiring team for.
 */
export const ROLES = [
  "admin",
  "head_of_talent",
  "ta_manager",
  "recruiter",
  "coordinator",
  "hiring_manager",
  "interviewer",
  "executive",
] as const;
export type Role = (typeof ROLES)[number];

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
    "jobs.edit_compensation",
  ],
  Candidates: ["candidates.view", "candidates.view_all", "candidates.create", "candidates.edit"],
  Applications: ["applications.view", "applications.move", "applications.reject", "applications.hire"],
  Notes: ["notes.view", "notes.write", "notes.phone_screen.read", "notes.phone_screen.write"],
  Scorecards: ["scorecards.view", "scorecards.view_all", "scorecards.submit"],
  Interviews: ["interviews.view", "interviews.schedule", "interviews.plan"],
  Email: ["email.send", "templates.view", "templates.manage"],
  Reports: ["reports.view", "reports.view_all", "reports.export", "dashboards.executive"],
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
  "jobs.edit_compensation",
  "applications.view",
  "applications.move",
  "applications.reject",
  "applications.hire",
  "notes.view",
  "notes.phone_screen.read",
  "notes.phone_screen.write",
  "scorecards.view",
  "scorecards.view_all",
  "interviews.view",
  "interviews.schedule",
  "interviews.plan",
  "email.send",
  "reports.view",
];

/** Roles on one job's hiring team (#96). */
export const TEAM_ROLES = ["hiring_manager", "recruiter", "coordinator", "interviewer", "viewer"] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];

export function isTeamRole(value: unknown): value is TeamRole {
  return typeof value === "string" && (TEAM_ROLES as readonly string[]).includes(value);
}

/** Seeing a job's pipeline, notes, interviews, and scorecards (subject to the blind rule). */
const TEAM_MEMBER: readonly Permission[] = ["applications.view", "notes.view", "scorecards.view", "interviews.view"];

/**
 * What each team role grants on that job, on top of the person's own role. For example an
 * Interviewer who is a job's hiring manager can see all its scorecards and move its candidates.
 */
export const TEAM_ROLE_PRESETS: Record<TeamRole, { name: string; description: string; permissions: readonly Permission[] }> = {
  hiring_manager: {
    name: "Hiring manager",
    description: "Moves, rejects, and hires; sees all scorecards and the job's reports; edits the job but not its pay.",
    permissions: [...TEAM_MEMBER, "jobs.edit", "jobs.view_compensation", "applications.move", "applications.reject", "applications.hire", "notes.phone_screen.read", "scorecards.view_all", "reports.view"],
  },
  recruiter: {
    name: "Recruiter",
    description: "The full hiring workflow on this job, including pay, phone screens, scheduling, and email.",
    permissions: [
      ...TEAM_MEMBER,
      "jobs.edit",
      "jobs.view_compensation",
      "jobs.edit_compensation",
      "applications.move",
      "applications.reject",
      "applications.hire",
      "notes.phone_screen.read",
      "notes.phone_screen.write",
      "scorecards.view_all",
      "interviews.schedule",
      "interviews.plan",
      "email.send",
      "reports.view",
    ],
  },
  coordinator: {
    name: "Coordinator",
    description: "Schedules interviews, edits the interview plan, emails candidates, and moves them between stages.",
    permissions: [...TEAM_MEMBER, "applications.move", "notes.phone_screen.read", "interviews.schedule", "interviews.plan", "email.send"],
  },
  interviewer: {
    name: "Interviewer",
    description: "Sees the job's candidates and interviews and gives feedback.",
    permissions: TEAM_MEMBER,
  },
  viewer: {
    name: "Viewer",
    description: "Can see the job and its candidates. Changes nothing.",
    permissions: ["applications.view", "interviews.view"],
  },
};

/** Job id to the permissions a user's team roles grant there, for `Actor.jobPermissions`. */
export function jobPermissionsFrom(rows: readonly { jobId: string; teamRole: TeamRole }[]): Record<string, readonly Permission[]> {
  return Object.fromEntries(rows.map((r) => [r.jobId, TEAM_ROLE_PRESETS[r.teamRole].permissions]));
}

/** The team role a job's named hiring manager or recruiter gets when the job form sets them. */
export function teamRoleForJobField(field: "hiringManagerId" | "recruiterId"): TeamRole {
  return field === "hiringManagerId" ? "hiring_manager" : "recruiter";
}

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

/** The full hiring workflow on every job. */
const HIRING: readonly Permission[] = [
  ...MEMBER,
  "jobs.view_all",
  "jobs.create",
  "jobs.edit",
  "jobs.view_compensation",
  "jobs.edit_compensation",
  "candidates.view_all",
  "candidates.create",
  "candidates.edit",
  "applications.move",
  "applications.reject",
  "applications.hire",
  "notes.phone_screen.read",
  "notes.phone_screen.write",
  "scorecards.view_all",
  "interviews.schedule",
  "interviews.plan",
  "email.send",
  "templates.view",
  "templates.manage",
  "reports.view",
];

const INSTANCE_ADMIN: readonly Permission[] = ["users.manage", "roles.manage", "settings.manage"];

const pick = (list: readonly Permission[]) => PERMISSIONS.filter((p) => list.includes(p));

export type RolePreset = { name: string; description: string; permissions: readonly Permission[] };

/** The system role presets from the access epic (#93), in the order they are offered. */
export const ROLE_PRESETS: Record<Role, RolePreset> = {
  admin: {
    name: "Admin",
    description: "Everything, including users and roles, settings, AI, email, privacy, and the audit log.",
    permissions: PERMISSIONS,
  },
  head_of_talent: {
    name: "Head of Talent",
    description: "Everything in hiring on every job, plus privacy requests, the audit log, and inviting users. Not instance settings.",
    permissions: PERMISSIONS.filter((p) => !INSTANCE_ADMIN.includes(p)),
  },
  ta_manager: {
    name: "Talent Acquisition Manager",
    description: "Runs the recruiting team: every job and candidate, all reports and exports, and inviting people to roles with no more access than their own.",
    permissions: pick([...HIRING, "reports.view_all", "reports.export", "dashboards.executive", "users.invite"]),
  },
  recruiter: {
    name: "Recruiter",
    description: "The full hiring workflow on every job. Reports cover the jobs they are on the hiring team for.",
    permissions: pick(HIRING),
  },
  coordinator: {
    name: "Recruiting Coordinator",
    description: "Scheduling, interview plans, candidate emails, and moving candidates on every job. No rejecting or hiring, compensation, or scorecard content.",
    permissions: pick([
      ...MEMBER.filter((p) => !p.startsWith("scorecards.")),
      "jobs.view_all",
      "candidates.view_all",
      "candidates.create",
      "candidates.edit",
      "applications.move",
      "notes.phone_screen.read",
      "interviews.schedule",
      "interviews.plan",
      "email.send",
      "templates.view",
      "templates.manage",
    ]),
  },
  hiring_manager: {
    name: "Hiring Manager",
    description: "Only jobs they are on the hiring team for: candidates, all scorecards, moving, rejecting, and hiring, editing the job (not its pay), and its reports.",
    permissions: pick([
      ...MEMBER,
      "jobs.edit",
      "jobs.view_compensation",
      "applications.move",
      "applications.reject",
      "applications.hire",
      "notes.phone_screen.read",
      "scorecards.view_all",
      "reports.view",
    ]),
  },
  interviewer: {
    name: "Interviewer",
    description: "Only jobs they are on the hiring team for: their interviews, their own scorecards (others' after submitting), and notes.",
    permissions: pick(MEMBER),
  },
  executive: {
    name: "Executive",
    description: "Dashboards, reports and exports, open jobs, compensation, and hires. No individual candidate records.",
    permissions: pick([
      "jobs.view",
      "jobs.view_all",
      "jobs.view_compensation",
      "reports.view",
      "reports.view_all",
      "reports.export",
      "dashboards.executive",
    ]),
  },
};

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = Object.fromEntries(
  ROLES.map((role) => [role, ROLE_PRESETS[role].permissions]),
) as Record<Role, readonly Permission[]>;

export function roleName(role: Role): string {
  return ROLE_PRESETS[role].name;
}

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
  const manages = (role: Role) => can({ role }, "roles.manage");
  return manages(input.currentRole) && input.currentActive &&
    (!manages(input.nextRole) || !input.nextActive) && input.activeAdminCount <= 1;
}

/**
 * Who may give a role to someone. Managing roles allows any role; inviting allows only roles
 * with no permission the inviter lacks, so nobody can hand out more access than they have.
 */
export function canAssignRole(actor: Actor, role: Role): boolean {
  if (can(actor, "roles.manage")) return true;
  if (!can(actor, "users.invite")) return false;
  return ROLE_PERMISSIONS[role].every((p) => can(actor, p));
}

/** The permission behind each application status change: hiring and rejecting are separate from moving. */
export function statusPermission(status: "hired" | "rejected" | "withdrawn" | "active"): Permission {
  return status === "hired" ? "applications.hire" : status === "rejected" ? "applications.reject" : "applications.move";
}

/** A role's display name from its key, or the key itself when it isn't a known preset. */
export function roleLabel(key: string): string {
  return isRole(key) ? ROLE_PRESETS[key].name : key;
}
