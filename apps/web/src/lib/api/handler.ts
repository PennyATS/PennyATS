/**
 * Turns a route table entry plus a function into a Next.js route handler. Every API request
 * goes through here: key lookup, rate limit, scope and permission check, input validation,
 * the consistent error format, and the audit log entry for writes.
 */
import { auditLog } from "@pennyats/db";
import type { z } from "zod";
import type { SessionUser } from "../auth";
import { db } from "../db";
import { createRateLimiter } from "../rate-limit";
import { bearerToken, keyLabel, lookupApiKey, type ApiKeyRecord } from "./keys";
import type { ApiRoute } from "./routes";
import { checkAccess } from "./scopes";

export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "missing_scope"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "unprocessable"
  | "rate_limited"
  | "internal";

const STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  missing_scope: 403,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
};

/** Throw from a handler to return a clean error response. */
export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Resource") => new ApiError("not_found", `${what} not found.`);

const NO_STORE = { "Cache-Control": "no-store" };

export function errorResponse(code: ErrorCode, message: string, details?: unknown, headers: Record<string, string> = {}) {
  return Response.json(
    { error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status: STATUS[code], headers: { ...NO_STORE, ...headers } },
  );
}

const perMinute = Math.max(1, Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 300);
const allowKey = createRateLimiter({ limit: perMinute, windowMs: 60_000 });
// Failed key lookups by IP, so guessing can't be used to hammer the database.
const allowBadAuth = createRateLimiter({ limit: 30, windowMs: 60_000 });

export type ActorType = "api_key" | "agent";

export type ApiContext<R extends ApiRoute> = {
  request: Request;
  user: SessionUser;
  key: ApiKeyRecord;
  actorType: ActorType;
  agent: string | null;
  params: R["params"] extends z.ZodType ? z.output<R["params"]> : Record<string, never>;
  query: R["query"] extends z.ZodType ? z.output<R["query"]> : Record<string, never>;
  body: R["body"] extends z.ZodType ? z.output<R["body"]> : undefined;
};

type Handler<R extends ApiRoute> = (ctx: ApiContext<R>) => Promise<z.input<R["response"]>>;

function issues(error: z.ZodError) {
  return error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
}

function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

/** `X-PennyATS-Agent: <name>` marks the request as coming from an AI agent. */
export function agentName(header: string | null): string | null {
  const name = header?.replace(/[^\w .@/:-]/g, "").trim().slice(0, 60);
  return name || null;
}

export function apiHandler<R extends ApiRoute>(route: R, fn: Handler<R>) {
  return async (request: Request, context: { params: Promise<Record<string, string | string[]>> }): Promise<Response> => {
    try {
      const token = bearerToken(request.headers.get("authorization"));
      if (!token) {
        return errorResponse("unauthorized", "Send an API key as `Authorization: Bearer <key>`.", undefined, {
          "WWW-Authenticate": 'Bearer realm="pennyats"',
        });
      }
      const ip = clientIp(request);
      const found = await lookupApiKey(token);
      if (!found.ok) {
        if (!allowBadAuth(ip)) return errorResponse("rate_limited", "Too many failed attempts.", undefined, { "Retry-After": "60" });
        const message =
          found.reason === "expired"
            ? "This API key has expired."
            : found.reason === "revoked"
              ? "This API key was revoked."
              : found.reason === "inactive_user"
                ? "The user this key acts as is deactivated."
                : "Invalid API key.";
        return errorResponse("unauthorized", message, undefined, { "WWW-Authenticate": 'Bearer realm="pennyats", error="invalid_token"' });
      }
      const { key, user } = found;
      if (!allowKey(key.id)) {
        return errorResponse("rate_limited", `Rate limit is ${perMinute} requests a minute per key.`, undefined, { "Retry-After": "60" });
      }

      if (route.scope && route.permission) {
        const access = checkAccess({ scopes: key.scopes, role: user.role }, { scope: route.scope, permission: route.permission });
        if (!access.ok) return errorResponse(access.code, access.message);
      }

      const rawParams = await context.params;
      const params = route.params ? route.params.safeParse(decodeParams(rawParams)) : { success: true as const, data: {} };
      if (!params.success) return errorResponse("not_found", "Not found.", issues(params.error));

      const url = new URL(request.url);
      const query = route.query ? route.query.safeParse(Object.fromEntries(url.searchParams)) : { success: true as const, data: {} };
      if (!query.success) return errorResponse("invalid_request", "Invalid query parameters.", issues(query.error));

      let body: { success: true; data: unknown } | { success: false; error: z.ZodError } = { success: true, data: undefined };
      if (route.body) {
        let json: unknown;
        try {
          json = await request.json();
        } catch {
          return errorResponse("invalid_request", "Send a JSON body with Content-Type: application/json.");
        }
        body = route.body.safeParse(json);
        if (!body.success) return errorResponse("invalid_request", "Invalid request body.", issues(body.error));
      }

      const agent = agentName(request.headers.get("x-pennyats-agent"));
      const actorType: ActorType = agent ? "agent" : "api_key";
      const result = await fn({
        request,
        user,
        key,
        actorType,
        agent,
        params: params.data,
        query: query.data,
        body: body.data,
      } as ApiContext<R>);

      const status = route.status ?? 200;
      if (route.audit) {
        await db().insert(auditLog).values({
          action: "api_write",
          actorId: user.id,
          actorType,
          apiKeyId: key.id,
          data: {
            method: route.method,
            route: route.path,
            operation: route.operationId,
            status,
            key: keyLabel(key.prefix),
            ...(agent ? { agent } : {}),
            // A deleted person's id is not kept, so the entry says nothing about who it was.
            ...(route.audit.resourceIdFrom === "params" && "id" in params.data ? { resource_id: (params.data as { id: string }).id } : {}),
          },
        });
      }
      return Response.json(result, { status, headers: NO_STORE });
    } catch (err) {
      if (err instanceof ApiError) return errorResponse(err.code, err.message, err.details);
      console.error(`API ${route.method} ${route.path} failed:`, err);
      return errorResponse("internal", "Something went wrong. The error was logged on the server.");
    }
  };
}

function decodeParams(raw: Record<string, string | string[]>): Record<string, string> {
  const out: Record<string, string> = {};
  // Next.js has already decoded the segments.
  for (const [k, v] of Object.entries(raw)) out[k] = Array.isArray(v) ? v.join("/") : v;
  return out;
}
