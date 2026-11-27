# Integrating with PennyATS

Outside tools connect to PennyATS through three public surfaces. Nothing here is a one-off connector:

| Surface | Use it to | Docs |
| --- | --- | --- |
| REST API (`/api/v1`) | push candidates in, read pipeline data, schedule interviews, move and note | [api.md](api.md) |
| Webhooks | react when someone applies, changes stage, or gets a scorecard | [api.md#webhooks](api.md#webhooks) |
| MCP server | let an AI assistant work the pipeline with tools | [mcp.md](mcp.md) |
| Open data format | bulk export and import, warehouses, migrations | [schema/README.md](schema/README.md) |

Each of the three tool types below has a working reference integration in [`examples/`](../examples). They are plain TypeScript, use only these surfaces, and run against a local PennyATS in CI (`apps/web/tests/integration/examples.spec.ts`), so they stay working as the API changes.

## Before you start

1. In PennyATS, go to **Admin > API and webhooks** and create one key per tool. A key acts as one teammate and can never do more than they can; pick only the scopes the tool needs.
2. Give sourcing tools a **source label** on their key (for example "Gem"). Candidates the key adds get that source unless the request sets one, so the sources report credits the tool. Every application an integration creates also records `via: api`, the key, and the key's name in its history.
3. Run the examples from a clone of this repository after `pnpm install`:

```bash
export PENNYATS_URL=http://localhost:3000
export PENNYATS_API_KEY=pats_...
```

## Sourcing tools: push prospects in

**Example:** [`examples/sourcing/push-prospects.ts`](../examples/sourcing/push-prospects.ts) reads a CSV of prospects and adds them to a job with tags.

```bash
pnpm --filter @pennyats/examples sourcing --job <job id> --file sourcing/prospects.csv
```

Key scopes: `candidates:write`, `tags:write`. Set the key's source label to the tool's name.

How it works:

1. `POST /candidates` with `job_id`, name, contact details, and `tags`. The candidate starts in the job's first stage, the hiring team is notified, and `application.created` fires.
2. A `409` means they already applied to that job. Its `details.candidate_id` points at the existing person, so the example adds the new tags with `POST /candidates/{id}/tags` instead of creating a duplicate. A known email is matched to the existing candidate, the same as the apply form.
3. It prints `{"created", "updated", "failed"}`. Running it again is safe.

To pull status back into the sourcing tool, subscribe to `application.stage_changed` or poll `GET /applications?candidate_id=...`.

## Scheduling tools: book interviews

**Example:** [`examples/scheduler/scheduler.ts`](../examples/scheduler/scheduler.ts) books interviews when a candidate enters a stage that has planned interviews.

```bash
# React to stage changes (add a webhook for application.stage_changed pointing at this server)
WEBHOOK_SECRET=whsec_... pnpm --filter @pennyats/examples scheduler --port 4010

# Or book everything still waiting, e.g. from cron
pnpm --filter @pennyats/examples scheduler --sweep --job <job id>
```

Key scopes: `interviews:read`, `interviews:write`. Optional settings: `SCHEDULER_TIME_ZONE` (default UTC) and `SCHEDULER_MEETING_URL`.

How it works:

1. When an application enters a stage, PennyATS creates that stage's planned interviews from the job's interview plan, then sends `application.stage_changed`.
2. The scheduler checks the webhook signature, answers 200 at once, and reads `GET /applications/{id}/interviews`.
3. For each interview with status `to_schedule`, it offers slots with `PATCH /interviews/{id}` (`scheduled_at`, `time_zone`, `meeting_location`). PennyATS refuses a slot that overlaps another PennyATS interview for the same interviewer with `409`, and the scheduler tries the next one.
4. A booked interview is logged on the candidate's timeline, synced to Google Calendar when the interviewer has connected it, and gets reminders, the same as booking from the candidate profile.
5. Sweep mode uses `GET /interviews?status=to_schedule` to find what is waiting.

A real scheduler would read the interviewers' calendars for free time; the example only offers weekday slots from 10:00 to 16:00. `PATCH /interviews/{id}` with `state` also marks an interview held (`complete`), cancels it, or restores it.

## AI assistants: work the pipeline

**Example:** [`examples/ai-assistant/triage.ts`](../examples/ai-assistant/triage.ts) triages a job's first stage through the MCP server.

```bash
pnpm --filter @pennyats/examples triage --job <job id>            # read-only: prints recommendations
pnpm --filter @pennyats/examples triage --job <job id> --apply    # also notes and advances
```

Key scopes: `jobs:read`, `applications:read`, `candidates:read`, `notes:read`; with `--apply`, also `notes:write` and `applications:write`.

How it works:

1. It starts the MCP server (`packages/mcp`) over stdio, the way Claude Desktop or Cursor would, read-only unless `--apply`.
2. It calls `list_jobs`, `list_applications` for the first stage, and `get_candidate` for each person. Contact details arrive redacted.
3. `assess()` decides advance or hold with reasons. In the example it is a visible keyword match so CI needs no model key; in a real assistant, call your model there and keep everything else.
4. With `--apply` it writes a note on every candidate (`add_note`) and moves matches to the next stage (`move_candidate_stage`). Both show in the audit log as agent activity with the client's name.
5. It never rejects: `reject_application` needs `confirm: true` and stays a person's decision.

For chat assistants rather than scripts, connect the MCP server directly; [mcp.md](mcp.md) has setup for Claude, ChatGPT, and Cursor and two ready-made prompts.

## Good practice

- **One key per tool,** with only the scopes it needs, an expiry, and a source label for sourcing tools. Revoke it when the tool goes away.
- **Treat webhooks as hints.** Verify the signature, answer quickly, de-duplicate on the event `id`, and fetch the current state from the API before acting.
- **Expect `409` and retry sensibly.** It means the state already changed (already applied, slot taken, already in that stage).
- **Keep candidate data where it is.** Webhook payloads carry ids only; fetch details with a scoped key when you need them and don't copy more than you use.
