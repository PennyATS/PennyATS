/**
 * Role rules in one place. Pure functions so they are easy to test.
 *
 * admin        everything, including users and invites
 * recruiter    jobs, candidates and applications
 * interviewer  read-only access to jobs they are on the hiring team for; can add notes
 */
export type Role = "admin" | "recruiter" | "interviewer";

export const ROLES: readonly Role[] = ["admin", "recruiter", "interviewer"];

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const canManageUsers = (role: Role) => role === "admin";

/** Create and edit jobs, move and reject applications, add candidates by hand. */
export const canManageHiring = (role: Role) => role === "admin" || role === "recruiter";

/** Interviewers only see jobs they are on the hiring team for. Everyone else sees all jobs. */
export const seesAllJobs = (role: Role) => role !== "interviewer";
