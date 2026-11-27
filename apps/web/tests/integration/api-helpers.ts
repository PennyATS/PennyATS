/** Shared setup for the API, webhook, and MCP integration tests: keys made straight in the test database. */
import { eq, inArray } from "drizzle-orm";
import { apiKeys, createDb, jobTeam, users } from "@pennyats/db";
import { expect, type APIRequestContext } from "@playwright/test";
import { generateApiKey } from "../../src/lib/api/keys";
import { routes, type ApiRoute, type RouteName } from "../../src/lib/api/routes";
import { SCOPES, scopesForRole, type Scope } from "../../src/lib/api/scopes";

export const db = createDb(process.env.TEST_DATABASE_URL);

export async function seededUsers() {
  const rows = await db.select().from(users);
  const by = (email: string) => {
    const user = rows.find((u) => u.email === email);
    if (!user) throw new Error(`Seed user ${email} is missing. Run pnpm test:integration from the repo root.`);
    return user;
  };
  const admin = by("admin@example.com");
  const recruiter = by("recruiter@example.com");
  const interviewer = rows.find((u) => u.role === "interviewer" && u.active && u.email.endsWith(".interviewer@example.com"));
  if (!interviewer) throw new Error("Seed interviewer is missing.");
  const team = await db.select({ jobId: jobTeam.jobId }).from(jobTeam).where(eq(jobTeam.userId, interviewer.id));
  return { admin, recruiter, interviewer, interviewerJobIds: team.map((t) => t.jobId) };
}

export async function makeKey(
  userId: string,
  scopes: readonly string[],
  opts: { name?: string; expiresAt?: Date | null; revokedAt?: Date | null; source?: string } = {},
): Promise<{ id: string; key: string }> {
  const generated = generateApiKey();
  const [row] = await db
    .insert(apiKeys)
    .values({
      name: opts.name ?? "integration test",
      prefix: generated.prefix,
      keyHash: generated.hash,
      userId,
      scopes: [...scopes],
      source: opts.source ?? null,
      expiresAt: opts.expiresAt ?? null,
      revokedAt: opts.revokedAt ?? null,
    })
    .returning({ id: apiKeys.id });
  return { id: row.id, key: generated.key };
}

export async function deleteKeys(ids: string[]) {
  if (ids.length) await db.delete(apiKeys).where(inArray(apiKeys.id, ids));
}

export const ALL_SCOPES: readonly Scope[] = SCOPES;
export { scopesForRole };

/** Every scope except the one(s) given, for "denied" calls that only lack the route's scope. */
export function allBut(...scopes: Scope[]): Scope[] {
  return SCOPES.filter((s) => !scopes.includes(s));
}

export type Call = { status: number; body: any };

/**
 * Call the API and, on success, parse the body with the route's declared response schema, so
 * the published contract is checked against the running server on every call.
 */
export function apiClient(request: APIRequestContext, coverage?: Map<string, Set<"allowed" | "denied">>) {
  return async function call(
    key: string | null,
    name: RouteName,
    opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
  ): Promise<Call> {
    const route: ApiRoute = routes[name];
    let path: string = route.path;
    for (const [k, v] of Object.entries(opts.params ?? {})) path = path.replace(`{${k}}`, encodeURIComponent(v));
    const qs = opts.query ? `?${new URLSearchParams(opts.query)}` : "";
    const res = await request.fetch(`/api/v1${path}${qs}`, {
      method: route.method,
      headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(opts.headers ?? {}) },
      ...(opts.body !== undefined ? { data: opts.body } : {}),
    });
    const body = await res.json().catch(() => null);
    if (res.ok()) {
      expect(res.status(), `${name} status`).toBe(route.status ?? 200);
      const parsed = route.response.safeParse(body);
      expect(parsed.success, `${name} response matches the published schema: ${JSON.stringify(parsed.error?.issues ?? [])}`).toBe(true);
      coverage?.get(name)?.add("allowed");
    } else {
      expect(body?.error?.code, `${name} error body has a code`).toBeTruthy();
      expect(typeof body?.error?.message).toBe("string");
      if (res.status() === 403) coverage?.get(name)?.add("denied");
    }
    return { status: res.status(), body };
  };
}
