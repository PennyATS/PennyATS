# Reference integrations

Small, working examples of the three kinds of tool that connect to PennyATS. The walkthrough is in [docs/integrations.md](../docs/integrations.md).

| Folder | Tool type | Uses |
| --- | --- | --- |
| [`sourcing/`](sourcing) | Sourcing tool pushing prospects into a job | REST API, key source label |
| [`scheduler/`](scheduler) | Scheduling tool booking interviews | Webhooks, `PATCH /interviews/{id}` |
| [`ai-assistant/`](ai-assistant) | AI assistant triaging a job's first stage | MCP server |

Run them from the repository root after `pnpm install`:

```bash
export PENNYATS_URL=http://localhost:3000 PENNYATS_API_KEY=pats_...
pnpm --filter @pennyats/examples sourcing --job <job id>
pnpm --filter @pennyats/examples scheduler --sweep --job <job id>
pnpm --filter @pennyats/examples triage --job <job id>
```

They run against a local PennyATS in CI (`apps/web/tests/integration/examples.spec.ts`). The sample CSV uses made-up people with `example.com` addresses.
