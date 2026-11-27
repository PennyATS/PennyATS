import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { and, eq, gt, lt } from "drizzle-orm";
import { applications, interviews, roles, sessions, users } from "@pennyats/db";
import { db } from "./db";
import { canSeeCandidate, canSeeJob, loadJobPermissions } from "./hiring";
import { isUuid } from "./validation";
import { can, isRole, permissionsForRole, type Permission, type Role } from "./permissions";

const COOKIE = "pennyats_session";
const SESSION_DAYS = 30;

/** `permissions` is resolved when the session is loaded, so checks with `can()` don't re-query. */
export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions: readonly Permission[];
  /** Extra permissions from hiring team roles, by job id (#96). Read per request, so changes apply at once. */
  jobPermissions: Readonly<Record<string, readonly Permission[]>>;
};

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored hashed, so a database leak can't be turned into logged-in sessions. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// Mark the cookie Secure when the app is served over https. Self-hosters testing on
// plain http (e.g. `next start` on localhost) would otherwise be unable to sign in.
const secureCookie = (process.env.APP_URL ?? "").startsWith("https://");

export async function startSession(userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db().insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  // Opportunistic cleanup instead of a cron job.
  await db().delete(sessions).where(lt(sessions.expiresAt, new Date()));
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookie,
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db().delete(sessions).where(eq(sessions.id, hashToken(token)));
  jar.delete(COOKIE);
}

/** The signed-in user, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [row] = await db()
    .select({ id: users.id, email: users.email, name: users.name, role: roles.key })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date()), eq(users.active, true)));
  // Only the system role presets exist today; an unknown key gets no access rather than a guess.
  if (!row || !isRole(row.role)) return null;
  return { ...row, role: row.role, permissions: permissionsForRole(row.role), jobPermissions: await loadJobPermissions(row.id) };
});

/**
 * Use at the top of every protected page and server action.
 * Signed out: redirect to /login. Missing the permission: 404, so pages don't reveal they exist.
 */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user, permission)) notFound();
  return user;
}

/**
 * The user must hold `permission` on this job, through their role or their team role on it
 * (#96), and be able to see the job. Use it in every action that changes a job.
 */
export async function requireJobAccess(permission: Permission, jobId: string): Promise<SessionUser> {
  const user = await requireUser();
  if (!isUuid(jobId) || !can(user, permission, { jobId }) || !(await canSeeJob(user, jobId))) notFound();
  return user;
}

/** `requireJobAccess` for actions that start from an application. */
export async function requireApplicationAccess(permission: Permission, applicationId: string): Promise<SessionUser> {
  if (!isUuid(applicationId)) notFound();
  const [app] = await db().select({ jobId: applications.jobId }).from(applications).where(eq(applications.id, applicationId));
  if (!app) notFound();
  return requireJobAccess(permission, app.jobId);
}

/** `requireJobAccess` for actions that start from an interview. */
export async function requireInterviewAccess(permission: Permission, interviewId: string): Promise<SessionUser> {
  if (!isUuid(interviewId)) notFound();
  const [row] = await db()
    .select({ jobId: applications.jobId })
    .from(interviews)
    .innerJoin(applications, eq(applications.id, interviews.applicationId))
    .where(eq(interviews.id, interviewId));
  if (!row) notFound();
  return requireJobAccess(permission, row.jobId);
}

/** The user must hold `permission` and be able to see the candidate through one of their jobs. */
export async function requireCandidateAccess(permission: Permission, candidateId: string): Promise<SessionUser> {
  const user = await requireUser(permission);
  if (!isUuid(candidateId) || !(await canSeeCandidate(user, candidateId))) notFound();
  return user;
}
