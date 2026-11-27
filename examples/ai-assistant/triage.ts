/**
 * Reference integration: an AI assistant working the pipeline through the PennyATS MCP server.
 *
 *   PENNYATS_URL=http://localhost:3000 PENNYATS_API_KEY=pats_... \
 *     pnpm --filter @pennyats/examples triage --job <job id> [--apply]
 *
 * It starts the MCP server (packages/mcp) over stdio, exactly as Claude Desktop or Cursor would,
 * and uses its tools: list_jobs, list_applications, get_candidate, then add_note and
 * move_candidate_stage with --apply. Without --apply the server runs read-only and nothing changes.
 * It never rejects anyone: that stays a person's decision (reject_application needs confirm: true).
 *
 * The judgment is `assess()`. Here it is a transparent keyword match so the example runs in CI with
 * no model key. In a real assistant, send the job and candidate to a model there instead, and keep
 * the rest: the MCP tools, the audit trail (writes show as agent activity), and the redaction of
 * contact details before anything reaches the model.
 *
 * Key scopes: jobs:read, applications:read, candidates:read, notes:read, and with --apply
 * notes:write and applications:write.
 */
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const jobId = arg("job");
const apply = process.argv.includes("--apply");
if (!process.env.PENNYATS_URL || !process.env.PENNYATS_API_KEY || !jobId) {
  console.error("Set PENNYATS_URL and PENNYATS_API_KEY, and pass --job <job id> [--apply].");
  process.exit(1);
}

type Job = { id: string; title: string; department: string | null; stages: { id: string; name: string }[] };
type Candidate = { id: string; full_name: string; tags: string[]; location: string | null; source: string | null };
export type Assessment = { verdict: "advance" | "hold"; reasons: string[] };

/** Words that say what the job is about, from its title and department. */
function keywords(job: Job): string[] {
  const stop = new Set(["senior", "staff", "lead", "principal", "junior", "engineer", "manager", "the", "and", "for", "of"]);
  return `${job.title} ${job.department ?? ""}`
    .toLowerCase()
    .split(/[^a-z0-9+#]+/)
    .filter((w) => w.length > 1 && !stop.has(w));
}

/** Replace this with a model call in a real assistant. */
export function assess(job: Job, candidate: Candidate): Assessment {
  const words = keywords(job);
  const matches = candidate.tags.filter((t) => words.includes(t.toLowerCase()));
  return matches.length
    ? { verdict: "advance", reasons: [`Tagged ${matches.map((m) => `#${m}`).join(", ")}, which matches the role.`] }
    : { verdict: "hold", reasons: ["No tags match the role yet; needs a person to review."] };
}

// Start the MCP server the same way an AI app would.
const mcpCli = fileURLToPath(new URL("../../packages/mcp/src/cli.ts", import.meta.url));
const client = new Client({ name: "example-triage-assistant", version: "1.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", mcpCli, ...(apply ? ["--read-write"] : [])],
    cwd: fileURLToPath(new URL("../../packages/mcp/", import.meta.url)),
    env: { ...(process.env as Record<string, string>) },
    stderr: "ignore",
  }),
);

async function tool<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { text: string }[] };
  const text = result.content.map((c) => c.text).join("\n");
  if (result.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text) as T;
}

try {
  const jobs = await tool<Job[]>("list_jobs");
  const job = jobs.find((j) => j.id === jobId);
  if (!job) throw new Error(`Job ${jobId} isn't visible to this key.`);
  const [first, next] = job.stages;
  const { applications } = await tool<{ applications: { id: string; candidate_id: string; stage_id: string }[] }>("list_applications", {
    job_id: job.id,
    stage_id: first.id,
    status: "active",
    limit: 100,
  });

  const report: { candidate: string; verdict: string; reasons: string[]; moved: boolean }[] = [];
  for (const app of applications) {
    const candidate = await tool<Candidate>("get_candidate", { candidate_id: app.candidate_id });
    const { verdict, reasons } = assess(job, candidate);
    let moved = false;
    if (apply) {
      await tool("add_note", { candidate_id: candidate.id, body: `Triage (assistant) for ${job.title}: ${verdict}. ${reasons.join(" ")}` });
      if (verdict === "advance" && next) {
        await tool("move_candidate_stage", { application_id: app.id, stage_id: next.id });
        moved = true;
      }
    }
    report.push({ candidate: candidate.full_name, verdict, reasons, moved });
  }

  for (const r of report) console.error(`${r.verdict.padEnd(8)} ${r.candidate}${r.moved ? ` -> ${next?.name}` : ""}  ${r.reasons.join(" ")}`);
  console.log(JSON.stringify({ reviewed: report.length, advanced: report.filter((r) => r.moved).length, applied: apply }));
} finally {
  await client.close();
}
