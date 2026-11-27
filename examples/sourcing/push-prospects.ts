/**
 * Reference integration: a sourcing tool pushing prospects into a PennyATS job.
 *
 *   PENNYATS_URL=http://localhost:3000 PENNYATS_API_KEY=pats_... \
 *     pnpm --filter @pennyats/examples sourcing --job <job id> --file sourcing/prospects.csv
 *
 * Give the key the `candidates:write` and `tags:write` scopes and a source label (for example
 * "Example Sourcer") when you create it in Settings > API and webhooks. Every candidate it adds is
 * then credited to that source in the sources report, and each application's history records the
 * key that added it.
 *
 * Safe to run again: people already in the job aren't duplicated; their new tags are added instead.
 * CSV columns: full_name, email, phone, linkedin_url, location, tags (tags separated by ";").
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const base = `${(process.env.PENNYATS_URL ?? "").replace(/\/+$/, "")}/api/v1`;
const key = process.env.PENNYATS_API_KEY;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const jobId = arg("job");
const file = arg("file") ?? fileURLToPath(new URL("./prospects.csv", import.meta.url));
if (!process.env.PENNYATS_URL || !key || !jobId) {
  console.error("Set PENNYATS_URL and PENNYATS_API_KEY, and pass --job <job id> [--file prospects.csv].");
  process.exit(1);
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

/** A small CSV reader: commas, double-quoted fields, "" for a quote inside quotes. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell), rows.push(row), (row = []), (cell = "");
    } else cell += ch;
  }
  if (cell || row.length) row.push(cell), rows.push(row);
  const [head, ...rest] = rows.filter((r) => r.some((c) => c.trim()));
  return rest.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

const prospects = parseCsv(readFileSync(file, "utf8"));
const result = { created: 0, updated: 0, failed: 0 };

for (const p of prospects) {
  const tags = (p.tags ?? "").split(";").map((t) => t.trim()).filter(Boolean);
  const created = await api("POST", "/candidates", {
    job_id: jobId,
    full_name: p.full_name,
    email: p.email || null,
    phone: p.phone || null,
    linkedin_url: p.linkedin_url || null,
    location: p.location || null,
    tags,
    // No `source` here: the key's source label is used, so the sources report credits this tool.
  });
  if (created.status === 201) {
    result.created++;
    console.error(`added   ${p.full_name}`);
  } else if (created.status === 409 && created.json?.error?.details?.candidate_id) {
    // Already in this job: keep PennyATS up to date with what the sourcing tool knows.
    if (tags.length) await api("POST", `/candidates/${created.json.error.details.candidate_id}/tags`, { tags });
    result.updated++;
    console.error(`exists  ${p.full_name} (tags updated)`);
  } else {
    result.failed++;
    console.error(`failed  ${p.full_name}: ${created.json?.error?.message ?? created.status}`);
  }
}

console.log(JSON.stringify(result));
// Set the code rather than calling process.exit(), so open connections close cleanly.
process.exitCode = result.failed ? 1 : 0;
