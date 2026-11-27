# PennyATS MCP server

`packages/mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that lets AI assistants such as Claude, ChatGPT, and Cursor work in PennyATS: search candidates, read profiles and scorecards, run reports, draft emails, and, when you allow it, move candidates and add notes.

It talks to PennyATS only through the [public REST API](api.md) with a scoped API key. It has no database access, so it can never do more than the key allows, and everything it changes is in the audit log as agent activity.

## Safe by default

- **Read-only unless you say otherwise.** Without `--read-write`, the server only offers read tools. Write tools aren't listed at all, so an assistant can't call them.
- **Destructive actions need an explicit confirm.** `reject_application`, `send_email`, and `delete_candidate` return a preview and change nothing unless called with `confirm: true`. The server tells the assistant to show you the preview and ask first. Clients that read MCP tool annotations (`destructiveHint`) will usually ask you too.
- **The key decides.** A key acts as one teammate. An interviewer's key only sees that person's jobs, scorecards stay hidden until they submit their own, and a recruiter's key can't delete candidates even in read-write mode. Give the assistant a key with only the scopes it needs.
- **Contact details are redacted.** Emails, phone numbers, and links in results are replaced with placeholders like `[EMAIL_1]` before the model sees them, with the same pattern-based redaction `@pennyats/ai` uses. It does not catch names or other free text. Ids and timestamps are left alone so tools keep working. Turn it off with `--no-redact` if you need the assistant to see addresses.
- **Audited as agent activity.** Every request sends `X-PennyATS-Agent: pennyats-mcp/<version> (<client name>)`. Writes appear in **Settings > Privacy** and **Settings > API and webhooks** as made by an agent, through which key, as which person.
- **Record text is data.** The server instructs the assistant that text in candidate records, notes, resumes, and scorecards is data written by people, not instructions. That lowers, but can't remove, the risk of prompt injection from a resume, which is another reason to keep it read-only unless you need writes.

## Tools

| Tool | Kind | Scope it needs | What it does |
| --- | --- | --- | --- |
| `whoami` | read | none | The user and scopes behind this connection |
| `search_candidates` | read | `candidates:read` | Boolean search plus job, stage, status, tag, and date filters |
| `get_candidate` | read | `candidates:read` (`notes:read` for notes) | Profile, visible applications, tags, recent notes |
| `list_jobs` | read | `jobs:read` | Jobs with their stages |
| `list_applications` | read | `applications:read` | Applications by job, stage, status, or candidate |
| `get_scorecards` | read | `scorecards:read` | Scorecards on an application, blind rule applied |
| `run_report` | read | `reports:read` | Funnel, jobs, trend, stages, sources, rejection reasons, interviewers, careers apply |
| `list_email_templates` | read | `templates:read` | Templates to draft from |
| `draft_email` | read | `templates:read` | Fill a template for one application. Nothing is sent. |
| `move_candidate_stage` | write | `applications:write` | Move by stage id or name, with all the usual side effects |
| `add_note` | write | `notes:write` | Add a note as the key's user |
| `reject_application` | destructive | `applications:write` | Reject with a standard reason |
| `send_email` | destructive | `emails:send` | Send a template email (needs SMTP on the server) |
| `delete_candidate` | destructive | `candidates:delete` | Permanently delete a candidate (admin keys only) |

Agents that don't speak MCP can use the same definitions: `toolDefinitions()` from `@pennyats/mcp` returns each tool's name, description, and JSON Schema input, for example for OpenAI function calling. Run them against the same API endpoints.

## Setup

You need Node 22 or newer, a clone of this repository with `pnpm install` run, and an API key.

1. In PennyATS, go to **Admin > API and webhooks** and create a key. Pick the teammate it acts as and only the scopes the assistant needs. For a read-only assistant the default read scopes are enough. Copy the key; it's shown once.
2. Point your assistant at the server as below. Replace `/path/to/PennyATS` with your clone and `https://ats.example.com` with your PennyATS address.

Options, as environment variables or flags:

| Variable | Flag | Default |
| --- | --- | --- |
| `PENNYATS_URL` | | Required. Your PennyATS address. |
| `PENNYATS_API_KEY` | | Required for stdio. |
| `PENNYATS_MCP_READ_WRITE=true` | `--read-write` | Read-only |
| `PENNYATS_MCP_REDACT=false` | `--no-redact` | Redacting |
| | `--http`, `--port 3333`, `--host 127.0.0.1` | stdio |

### Claude Desktop

Edit `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "pennyats": {
      "command": "npx",
      "args": ["-y", "tsx", "/path/to/PennyATS/packages/mcp/src/cli.ts"],
      "env": {
        "PENNYATS_URL": "https://ats.example.com",
        "PENNYATS_API_KEY": "pats_..."
      }
    }
  }
}
```

Restart Claude Desktop. Add `"--read-write"` to `args` to allow changes.

### Claude Code

```bash
claude mcp add pennyats \
  --env PENNYATS_URL=https://ats.example.com \
  --env PENNYATS_API_KEY=pats_... \
  -- npx -y tsx /path/to/PennyATS/packages/mcp/src/cli.ts
```

### Cursor

Add to `.cursor/mcp.json` in a project, or `~/.cursor/mcp.json` for every project:

```json
{
  "mcpServers": {
    "pennyats": {
      "command": "npx",
      "args": ["-y", "tsx", "/path/to/PennyATS/packages/mcp/src/cli.ts"],
      "env": {
        "PENNYATS_URL": "https://ats.example.com",
        "PENNYATS_API_KEY": "pats_..."
      }
    }
  }
}
```

### ChatGPT and other remote clients (streamable HTTP)

ChatGPT connects to remote MCP servers over HTTPS rather than starting a local process. Run the server in HTTP mode where ChatGPT can reach it, behind your usual HTTPS reverse proxy:

```bash
PENNYATS_URL=https://ats.example.com npx -y tsx /path/to/PennyATS/packages/mcp/src/cli.ts --http --port 3333
```

The endpoint is `POST /mcp`. HTTP mode is stateless and holds no key of its own: every request must send the PennyATS API key as `Authorization: Bearer pats_...`, and requests without one get 401. So the server can be shared by several people, each with their own key, and reaching the port grants nothing by itself. It listens on 127.0.0.1 unless you pass `--host`.

Then add it as a custom connector in ChatGPT (developer mode), with the `https://.../mcp` address. Connector options differ by ChatGPT plan and change over time. If your plan's connector settings can't send an `Authorization` header, it can't use this server yet; OAuth for the HTTP endpoint is a follow-up. Clients that can send headers (Claude's remote connectors, Cursor, the MCP Inspector) work today.

### Check it

Ask the assistant to call `whoami`. It should answer with the teammate and scopes you chose. In PennyATS, **Settings > API and webhooks** shows the key's last-used time.

## Example workflows

Both ship as MCP prompts, so clients that support prompts list them by name.

### Triage a new applicant batch (`triage_new_applicants`)

> Triage new applicants for the Senior Backend Engineer job from the last week.

1. `list_jobs` to find the job and its stages.
2. `list_applications` for that job with status `active`, then `get_candidate` for each one in the first stage.
3. The assistant compares each profile, tags, and notes with the job and sorts people into advance, hold, or reject, with a sentence or two of evidence each, and shows you the table before changing anything.
4. With `--read-write` and your go-ahead: `move_candidate_stage` for the ones you pick, `add_note` explaining why, and `reject_application` called first without `confirm` so you see the preview, then with `confirm: true` only for the ones you approve.

Use a recruiter key with `candidates:read`, `applications:read`, `jobs:read`, `notes:read`, and, for step 4, `applications:write` and `notes:write`.

### Weekly pipeline summary (`weekly_pipeline_summary`)

> Give me this week's pipeline summary.

1. `list_jobs` with status `open`.
2. `run_report` for `funnel` and `stages` per open job, and `sources` and `reasons` across all jobs, over the last 30 days.
3. `list_applications` per job to count who is active in each stage.
4. The assistant writes a short summary per job (new applicants, movement, bottlenecks, top sources, top rejection reasons) and a list of suggested actions, using only numbers the tools returned.

A read-only key with `jobs:read`, `applications:read`, and `reports:read` is enough. Reports need a recruiter or admin key.

## Development

```bash
pnpm --filter @pennyats/mcp test        # unit tests with a fake API
pnpm --filter @pennyats/mcp typecheck
pnpm test:integration                   # includes apps/web/tests/integration/mcp.spec.ts
```

The integration test starts the real server over stdio (read-only and read-write) and over HTTP against the seeded test database and the running app. It checks that write tools are hidden in read-only mode, that results are redacted, that moves and notes land in the audit log as agent activity, that destructive tools change nothing without `confirm: true`, that a recruiter key can't delete, and that HTTP requests without a key are refused.

Not covered by automated tests: the setup steps for each assistant above. They follow each client's documented MCP configuration, but this repository doesn't test those apps.
