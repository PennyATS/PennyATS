/**
 * Who the database should treat as the acting user (#119). Read by the RLS client in
 * `lib/db.ts` before every statement.
 *
 * - Pages and server actions: `getCurrentUser()` binds the signed-in user to the request
 *   (React's per-request cache).
 * - API routes: `apiHandler` runs the handler inside `withActor(user, ...)`.
 * - Anything without a user (careers page, booking links, background jobs) runs as "system".
 * - `withScorecardFacts` and `asSystem` widen access for one block of code, on purpose.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { cache } from "react";
import type { RlsSettings } from "@pennyats/db";
import { can, type Actor } from "./permissions";

type Ctx = { actor: { id: string; flags: string[] } | null; extra: string[]; system: boolean };

const storage = new AsyncLocalStorage<Ctx>();

/** One mutable holder per request in server components and actions; a fresh one elsewhere. */
const requestHolder = cache((): { actor: Ctx["actor"] } => ({ actor: null }));

function holder(): { actor: Ctx["actor"] } | null {
  try {
    return requestHolder();
  } catch {
    return null;
  }
}

/** The role-based flags the policies read. Team roles are looked up in the database. */
export function actorFlags(user: Actor & { id: string }): Ctx["actor"] {
  const flags: string[] = [];
  if (can(user, "jobs.view_all")) flags.push("view_all_jobs");
  if (can(user, "jobs.view_confidential")) flags.push("view_confidential");
  if (can(user, "scorecards.view_all")) flags.push("view_all_scorecards");
  if (can(user, "notes.phone_screen.read")) flags.push("phone_screen_read");
  return { id: user.id, flags };
}

/** Called once the request's user is known. */
export function bindActor(user: Actor & { id: string }): void {
  const actor = actorFlags(user);
  const store = storage.getStore();
  if (store) store.actor = actor;
  const h = holder();
  if (h) h.actor = actor;
}

/** Run `fn` as this user, for code paths outside React's request scope (API routes). */
export function withActor<T>(user: Actor & { id: string }, fn: () => Promise<T>): Promise<T> {
  return storage.run({ actor: actorFlags(user), extra: [], system: false }, fn);
}

function current(): Ctx {
  const store = storage.getStore();
  const actor = store?.actor ?? holder()?.actor ?? null;
  return { actor, extra: store?.extra ?? [], system: store?.system ?? false };
}

/**
 * Let the queries in `fn` count other people's scorecards (who submitted, recommendations)
 * without changing who may read them elsewhere. Only for counts and aggregates, never to
 * show content.
 */
export function withScorecardFacts<T>(fn: () => Promise<T>): Promise<T> {
  const c = current();
  return storage.run({ ...c, extra: [...c.extra, "scorecard_facts"] }, fn);
}

/** Run `fn` with no acting user, after the caller has checked permissions (workspace import). */
export function asSystem<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ actor: null, extra: [], system: true }, fn);
}

export function rlsSettings(): RlsSettings {
  const c = current();
  if (!c.actor || c.system) return { actorId: null, flags: ["system", ...c.extra] };
  return { actorId: c.actor.id, flags: [...c.actor.flags, ...c.extra] };
}

/** A fresh scope for one request outside React's (API route handlers); `bindActor` fills it in. */
export function withRequestScope<T>(fn: () => Promise<T>): Promise<T> {
  return storage.run({ actor: null, extra: [], system: false }, fn);
}
