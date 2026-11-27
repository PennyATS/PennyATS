# PennyATS REST API

PennyATS has a public REST API under `/api/v1` so scripts, integrations, and AI agents can do the everyday hiring work people do in the app. There are no per-seat limits: any number of keys, for any number of tools.

- **Reference:** [`docs/api/openapi.json`](api/openapi.json) (OpenAPI 3.1). Your instance also serves it at `/api/v1/openapi.json`. Load it into Swagger UI, Postman, or an agent framework.
- **Integrations:** [integrations.md](integrations.md) walks through a sourcing tool, a scheduler, and an AI assistant, with reference code in `examples/`.
- **Agents:** the [MCP server](mcp.md) lets Claude, ChatGPT, and Cursor use this API with a scoped key.

The OpenAPI document is generated from the same zod schemas the endpoints validate requests with (`apps/web/src/lib/api/`). Run `pnpm api:spec` after changing the API. CI fails when the committed document and the code disagree.

## Keys

An admin creates keys in **Settings > API and webhooks**.

- **A key acts as one teammate.** It can never do more than that person can do in the app. Pick the teammate when you create the key.
- **Scopes narrow it further.** A request needs both the route's scope on the key and the permission on the person's role.
- **Shown once.** The full key is displayed when it is created and never again. Only its SHA-256 hash is stored, plus an 8-character prefix so you can tell keys apart: `pats_1a2b3c4d_…`.
- **Source label.** Optional. Candidates the key adds get this source (for example "Gem") unless the request sets one, so the sources report credits the integration. Their application history also records `via: api`, the key, and its name.
- **Expiry, last used, revoke.** Keys can expire after 30, 90, or 365 days. The settings page shows when each key was last used (to the minute). Revoking takes effect on the next request.
- **Deactivated teammates.** A key stops working when the person it acts as is deactivated.

Send the key as a bearer token:

```bash
curl -H "Authorization: Bearer $PENNYATS_API_KEY" https://ats.example.com/api/v1/me
```

### Visibility is the same as in the app

- Interviewer keys only see jobs their teammate is on the hiring team for, and only candidates and applications on those jobs. Anything else returns 404, so a key can't learn what exists.
- Scorecards stay hidden until the key's teammate has submitted their own scorecard on that application. `GET /applications/{id}/scorecards` returns `hidden_count` so you know some exist.
- Compensation and internal job notes aren't exposed through the API yet.

### Scopes

| Scope | Lets the key | Permission behind it |
| --- | --- | --- |
| `jobs:read` | List and view jobs | `jobs.view` |
| `jobs:write` | Create and edit jobs | `jobs.create`, `jobs.edit` |
| `stages:read` | View a job's pipeline stages | `jobs.view` |
| `stages:write` | Add pipeline stages | `jobs.edit` |
| `candidates:read` | Search and view candidates | `candidates.view` |
| `candidates:write` | Add candidates | `candidates.create` |
| `candidates:delete` | Permanently delete candidates | `privacy.delete` |
| `applications:read` | List and view applications | `applications.view` |
| `applications:write` | Add applications, move stages, hire, reject, withdraw, reopen | `applications.move` |
| `scorecards:read` | Read scorecards, blind until the key's user submits | `scorecards.view` |
| `scorecards:write` | Submit scorecards as the key's user | `scorecards.submit` |
| `notes:read` | Read candidate notes | `notes.view` |
| `notes:write` | Add candidate notes | `notes.write` |
| `tags:read` | Read candidate tags | `candidates.view` |
| `tags:write` | Add and remove tags | `candidates.edit` |
| `interviews:read` | View interviews | `interviews.view` |
| `interviews:write` | Add, schedule, complete, cancel, and restore interviews | `interviews.schedule` |
| `reports:read` | Run reports | `reports.view` |
| `templates:read` | List email templates and draft emails | `templates.view` |
| `emails:send` | Send template emails to candidates | `email.send` |

The permission names come from the app's permission model ([#94](https://github.com/PennyATS/PennyATS/issues/94), `apps/web/src/lib/permissions.ts`). The API runs the same `can(user, permission)` check as the app, so a key can never do more than its user can in the UI. For the API's permissions, the default roles get:

| Role | Permissions |
| --- | --- |
| Admin | All |
| Recruiter | All except `privacy.delete` |
| Interviewer | `jobs.view`, `candidates.view`, `applications.view`, `scorecards.view`, `scorecards.submit`, `notes.view`, `notes.write`, `interviews.view` |

A request is allowed when the key has the scope and its user has the permission. Which jobs the user can see is applied on top of that.

## Requests and responses

- JSON in and out, with `snake_case` fields and ISO 8601 UTC timestamps.
- Request bodies are strict: unknown fields are rejected so typos don't fail silently.
- Responses are never cached (`Cache-Control: no-store`).

### Pagination

List endpoints return `{ "data": [...], "next_cursor": "..." }`, newest first. Pass `limit` (1 to 100, default 25) and, for the next page, `cursor` set to the previous `next_cursor`. The last page has `next_cursor: null`. Cursors are opaque; don't build them yourself.

### Errors

Every error has the same shape:

```json
{ "error": { "code": "missing_scope", "message": "This API key needs the applications:write scope." } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `invalid_request` | The body or query didn't match the schema. `details` lists each problem. |
| 401 | `unauthorized` | Missing, malformed, unknown, expired, or revoked key, or a deactivated teammate. |
| 403 | `missing_scope` | The key doesn't have the route's scope. |
| 403 | `forbidden` | The key's teammate doesn't have the permission (for example an interviewer key moving a candidate). |
| 404 | `not_found` | It doesn't exist, or the key's teammate can't see it. |
| 409 | `conflict` | It conflicts with the current state (already applied, already in that stage). |
| 422 | `unprocessable` | Valid, but the app's rules don't allow it (moving a rejected application, sending email without SMTP). |
| 429 | `rate_limited` | Too many requests. Wait `Retry-After` seconds. |
| 500 | `internal` | A bug. The details are in the server log, never in the response. |

### Rate limits

Each key may make 300 requests a minute by default (`API_RATE_LIMIT_PER_MINUTE`). Failed key lookups are limited to 30 a minute per IP address. Like the login limiter, counting is in memory per server process; run one process or put a shared limiter in front if you scale out.

## Endpoints

| Method | Path | Scope |
| --- | --- | --- |
| GET | `/me` | none |
| GET, POST | `/jobs` | `jobs:read`, `jobs:write` |
| GET, PATCH | `/jobs/{id}` | `jobs:read`, `jobs:write` |
| GET, POST | `/jobs/{id}/stages` | `stages:read`, `stages:write` |
| GET, POST | `/candidates` | `candidates:read`, `candidates:write` |
| GET, DELETE | `/candidates/{id}` | `candidates:read`, `candidates:delete` |
| GET, POST | `/candidates/{id}/tags` | `tags:read`, `tags:write` |
| DELETE | `/candidates/{id}/tags/{tag}` | `tags:write` |
| GET, POST | `/candidates/{id}/notes` | `notes:read`, `notes:write` |
| GET, POST | `/applications` | `applications:read`, `applications:write` |
| GET | `/applications/{id}` | `applications:read` |
| POST | `/applications/{id}/move` | `applications:write` |
| POST | `/applications/{id}/status` | `applications:write` |
| GET, POST | `/applications/{id}/scorecards` | `scorecards:read`, `scorecards:write` |
| GET, POST | `/applications/{id}/interviews` | `interviews:read`, `interviews:write` |
| GET | `/interviews` | `interviews:read` |
| GET, PATCH | `/interviews/{id}` | `interviews:read`, `interviews:write` |
| POST | `/applications/{id}/email-drafts` | `templates:read` |
| POST | `/applications/{id}/emails` | `emails:send` |
| GET | `/email-templates` | `templates:read` |
| GET | `/reports/{table}` | `reports:read` |

The endpoints run the same code as the app. Moving an application through the API logs stage history, creates the stage's planned interviews, sends the stage's automatic email if one is set, notifies the hiring team, and fires a webhook, exactly like dragging a card on the pipeline board.

### Examples

Search for active candidates tagged `backend`:

```bash
curl -G -H "Authorization: Bearer $KEY" https://ats.example.com/api/v1/candidates \
  --data-urlencode 'q=rust OR go' -d tag=backend -d status=active -d limit=50
```

Add a candidate to a job:

```bash
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  https://ats.example.com/api/v1/candidates \
  -d '{"job_id": "…", "full_name": "Ada Lovelace", "email": "ada@example.com", "source": "Referral"}'
```

Move to the next stage, then reject a different application with a standard reason:

```bash
curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  https://ats.example.com/api/v1/applications/$APP/move -d '{"stage_id": "…"}'

curl -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  https://ats.example.com/api/v1/applications/$OTHER/status \
  -d '{"status": "rejected", "reason": "Not enough relevant experience", "note": "Revisit in a year"}'
```

## Audit log

Every API write is recorded in the audit log (Settings > Privacy, and the recent activity list on Settings > API and webhooks) with the key as the actor: the method, route, status, the key's prefix, and the id of the record changed. Entries show who the key acts as.

AI agents should send `X-PennyATS-Agent: <name>` (the MCP server does). Their writes are then recorded as agent activity, so you can tell what a person did, what a script did, and what an agent did.

Deleting a candidate through the API records that a deletion happened and which key did it, never the person's id, name, or contact details. Creating and revoking keys and adding or removing webhooks are audited too.

## Privacy

Data created through the API is ordinary candidate data. It shows up in the candidate's data export, it is removed by permanent deletion and by the retention purge, and webhook deliveries about a candidate are deleted with them.

## Webhooks

An admin adds webhook endpoints in **Settings > API and webhooks** and picks the events:

| Event | When |
| --- | --- |
| `application.created` | Someone applied, or a candidate was added to a job (in the app or the API) |
| `application.stage_changed` | An application moved to another stage |
| `scorecard.submitted` | A scorecard was submitted or edited |

Events fire whether the change came from the app, the careers page, or the API.

### Payload

```json
{
  "id": "3f1c…",
  "type": "application.stage_changed",
  "created_at": "2026-11-26T18:04:11.201Z",
  "data": {
    "application_id": "…",
    "candidate_id": "…",
    "job_id": "…",
    "from_stage_id": "…",
    "to_stage_id": "…",
    "to_stage_name": "Onsite"
  }
}
```

Payloads hold ids and stage names only. Names, emails, phone numbers, and scorecard content are never sent; fetch what you need through the API with a key scoped to just that. `id` is the same for every endpoint and every retry of one event, so use it to ignore duplicates.

### Headers and signature

| Header | Value |
| --- | --- |
| `PennyATS-Event` | The event type |
| `PennyATS-Event-Id` | The event id (same as `id` in the body) |
| `PennyATS-Delivery` | This delivery's id, as shown in the delivery log |
| `PennyATS-Signature` | `t=<unix seconds>,v1=<hex HMAC-SHA256>` |

The signature is HMAC-SHA256, keyed with the endpoint's signing secret (shown once when you add it), over the string `<t>.<raw body>`. Check it before trusting the payload, and reject old timestamps to stop replays:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret: string, rawBody: string, header: string, toleranceSeconds = 300): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2)));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex"));
  const given = Buffer.from(parts.v1 ?? "");
  return expected.length === given.length && timingSafeEqual(expected, given);
}
```

Signing secrets are encrypted in the database with `AUTH_SECRET` (HMAC needs the secret back, so it can't be hashed). Keep `AUTH_SECRET` stable.

### Delivery and retries

- Events are queued in the same database transaction as the change, so a rolled-back change never sends an event.
- Delivery starts right after the change. Any 2xx response counts as delivered. Redirects are not followed. Requests time out after 10 seconds.
- Failures are retried 8 times with exponential backoff (30 seconds, 1, 2, 4, 8, 16, 32, then 64 minutes), then marked failed.
- The delivery log on the settings page shows each delivery's result, attempts, and next retry. **Send again** queues a delivered or failed one again.
- The running server retries on a timer. A restart loses the timer, so also schedule `pnpm webhooks:deliver` (for example every 5 minutes with cron). It is safe to run while the app is running: deliveries are claimed with row locks, so two senders never send the same attempt.
- In production, webhook URLs must use https (localhost excepted).

## Design notes

- **Why keys act as a person.** It reuses the app's visibility rules (hiring teams, blind scorecards) instead of a second permission system that could drift, and it makes the audit log readable: you can see whose authority a script used.
- **Why thin webhook payloads.** Webhook receivers are often third-party automation tools. Sending only ids keeps candidate details inside your database unless a scoped key asks for them.
- **Why zod.** The API needed one schema per endpoint for validation and documentation. zod 4 converts to JSON Schema itself, so that is one small dependency instead of a validator plus an OpenAPI generator.
