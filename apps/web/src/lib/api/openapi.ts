/**
 * Builds the OpenAPI 3.1 document from the route table and its zod schemas. Pure and
 * deterministic, so a unit test can compare it with the committed docs/api/openapi.json.
 */
import { z } from "zod";
import { BRAND } from "../brand";
import { WEBHOOK_EVENT_DESCRIPTIONS, WEBHOOK_EVENT_NAMES } from "../webhook-events";
import { ROUTE_LIST, type ApiRoute } from "./routes";
import { ErrorBody, registry } from "./schemas";
import { SCOPE_DESCRIPTIONS, SCOPE_PERMISSIONS, SCOPES } from "./scopes";

export const API_VERSION = "1.0.0";

type Json = Record<string, unknown>;

const DEFS = "#/$defs/";
const COMPONENTS = "#/components/schemas/";

/** zod emits $defs per schema; hoist them into components and point refs there. */
function convert(schema: z.ZodType, io: "input" | "output", components: Record<string, Json>): Json {
  const out = z.toJSONSchema(schema, {
    metadata: registry,
    io,
    unrepresentable: "any",
    reused: "inline",
    // Ids come from our own registry; `.describe()` and `.meta()` text lives in zod's global one.
    override: (ctx) => {
      const meta = z.globalRegistry.get(ctx.zodSchema);
      if (!meta) return;
      const json = ctx.jsonSchema as Json;
      for (const [k, v] of Object.entries(meta)) if (k !== "id" && json[k] === undefined) json[k] = v;
    },
  }) as Json;
  const defs = (out.$defs ?? {}) as Record<string, Json>;
  delete out.$defs;
  delete out.$schema;
  for (const [name, def] of Object.entries(defs)) components[name] ??= clean(def);
  // A named schema at the top level comes back as itself with an id; reference it instead.
  const id = registry.get(schema)?.id;
  if (id) {
    components[id] ??= clean(out);
    return { $ref: COMPONENTS + id };
  }
  return clean(out);
}

/** Rewrite refs and drop the long generated regexes that duplicate `format`. */
function clean<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clean) as T;
  if (!value || typeof value !== "object") return value;
  const out: Json = {};
  for (const [k, v] of Object.entries(value as Json)) {
    if (k === "$ref" && typeof v === "string" && v.startsWith(DEFS)) out[k] = COMPONENTS + v.slice(DEFS.length);
    else if (k === "pattern" && (value as Json).format) continue;
    // z.number().int() adds the safe-integer range, which says nothing useful.
    else if ((k === "minimum" || k === "maximum") && Math.abs(Number(v)) === Number.MAX_SAFE_INTEGER) continue;
    else out[k] = clean(v);
  }
  return out as T;
}

function parameters(route: ApiRoute, components: Record<string, Json>): Json[] {
  const list: Json[] = [];
  for (const [where, schema] of [["path", route.params], ["query", route.query]] as const) {
    if (!schema) continue;
    const json = convert(schema, "input", components) as { properties?: Record<string, Json>; required?: string[] };
    for (const [name, prop] of Object.entries(json.properties ?? {})) {
      const { description, ...rest } = prop;
      list.push({
        name,
        in: where,
        required: where === "path" || (json.required ?? []).includes(name),
        ...(description ? { description } : {}),
        schema: rest,
      });
    }
  }
  return list;
}

const ERROR_RESPONSES: Record<string, string> = {
  "400": "The request didn't match the schema. `details` lists the problems.",
  "401": "Missing, malformed, unknown, expired, or revoked key.",
  "403": "The key lacks the scope (`missing_scope`), or its user lacks the permission (`forbidden`).",
  "404": "Not found, or not visible to the key's user.",
  "429": "Too many requests for this key. Wait for `Retry-After` seconds.",
};

function operation(route: ApiRoute, components: Record<string, Json>): Json {
  const errors: Record<string, Json> = {};
  for (const [code, description] of Object.entries(ERROR_RESPONSES)) {
    if (code === "400" && !route.body && !route.query && !route.params) continue;
    errors[code] = { description, content: { "application/json": { schema: { $ref: `${COMPONENTS}Error` } } } };
  }
  if (route.method !== "GET") {
    errors["409"] = { description: "Conflicts with the current state.", content: { "application/json": { schema: { $ref: `${COMPONENTS}Error` } } } };
    errors["422"] = { description: "Valid request that the app's rules don't allow.", content: { "application/json": { schema: { $ref: `${COMPONENTS}Error` } } } };
  }
  const scopeNote = route.scope
    ? `\n\nScope: \`${route.scope}\`. Permission: \`${route.permission}\`.`
    : "\n\nNo scope needed.";
  return {
    operationId: route.operationId,
    tags: [route.tag],
    summary: route.summary,
    description: `${route.description ?? route.summary}${scopeNote}${route.audit ? " Recorded in the audit log." : ""}`,
    security: [{ apiKey: route.scope ? [route.scope] : [] }],
    ...(route.scope ? { "x-required-scope": route.scope, "x-required-permission": route.permission } : {}),
    parameters: parameters(route, components),
    ...(route.body
      ? { requestBody: { required: true, content: { "application/json": { schema: convert(route.body, "input", components) } } } }
      : {}),
    responses: {
      [String(route.status ?? 200)]: {
        description: "OK",
        content: { "application/json": { schema: convert(route.response, "output", components) } },
      },
      ...errors,
    },
  };
}

export function buildOpenApi(): Json {
  const components: Record<string, Json> = {};
  convert(ErrorBody, "output", components);
  const paths: Record<string, Json> = {};
  for (const route of ROUTE_LIST) {
    paths[route.path] ??= {};
    (paths[route.path] as Json)[route.method.toLowerCase()] = operation(route, components);
  }
  const sortedComponents = Object.fromEntries(Object.entries(components).sort(([a], [b]) => a.localeCompare(b)));

  return {
    openapi: "3.1.0",
    info: {
      title: `${BRAND.name} API`,
      version: API_VERSION,
      description: [
        `The public REST API for ${BRAND.name}. Generated from the code by \`pnpm api:spec\`; do not edit by hand.`,
        "",
        "Authenticate with `Authorization: Bearer <key>`. An admin creates keys in Settings > API. A key acts as one user and can never do more than that user; its scopes narrow it further. Interviewer keys only see jobs their user is on the hiring team for, and scorecards stay hidden until their user has submitted their own.",
        "",
        "Lists are paginated with `limit` and `cursor`; follow `next_cursor` until it is null. Errors always look like `{\"error\": {\"code\", \"message\", \"details\"}}`.",
        "",
        "Every write is recorded in the audit log with the key as actor. Send `X-PennyATS-Agent: <name>` from AI agents so their actions show as agent activity.",
      ].join("\n"),
    },
    servers: [{ url: "/api/v1", description: "Relative to your PennyATS instance, e.g. https://ats.example.com/api/v1" }],
    security: [{ apiKey: [] }],
    tags: [...new Set(ROUTE_LIST.map((r) => r.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        apiKey: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "pats_<prefix>_<secret>",
          description: "API key from Settings > API.",
        },
      },
      schemas: sortedComponents,
    },
    "x-scopes": SCOPES.map((scope) => ({
      scope,
      description: SCOPE_DESCRIPTIONS[scope],
      permissions: SCOPE_PERMISSIONS[scope],
    })),
    "x-webhooks": WEBHOOK_EVENT_NAMES.map((event) => ({ event, description: WEBHOOK_EVENT_DESCRIPTIONS[event] })),
  };
}

/** The committed file's exact text: stable key order, two-space indent, trailing newline. */
export function openApiText(): string {
  return `${JSON.stringify(buildOpenApi(), null, 2)}\n`;
}
