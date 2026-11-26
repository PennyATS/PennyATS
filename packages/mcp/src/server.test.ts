import assert from "node:assert/strict";
import { test } from "node:test";
import { PennyClient } from "./client.js";
import { AGENT, callTool, redactValue } from "./server.js";
import { TOOLS, toolDefinitions, toolsFor } from "./tools.js";

const APP = "0b9f6f0e-1d2c-4c41-9b1a-0d6b2f1f7a10";
const CAND = "1c2d3e4f-0000-4000-8000-123456789012";

/** A fake PennyATS API that records requests. */
function fakeApi(responses: Record<string, unknown> = {}, status = 200) {
  const calls: { method: string; path: string; headers: Record<string, string>; body?: unknown }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname.replace("/api/v1", "");
    calls.push({ method: String(init.method), path, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const key = `${init.method} ${path}`;
    const body = key in responses ? responses[key] : { ok: true };
    const code = (body as { __status?: number })?.__status ?? status;
    return new Response(JSON.stringify(body), { status: code });
  }) as unknown as typeof fetch;
  const client = new PennyClient({ baseUrl: "https://ats.example.com/", apiKey: "pats_test", agent: AGENT, fetch: fetchFn });
  return { client, calls };
}

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

test("read-only mode offers only read tools", () => {
  const readOnly = toolsFor({ readOnly: true }).map((t) => t.name);
  assert.ok(readOnly.includes("search_candidates"));
  assert.ok(readOnly.includes("draft_email"));
  for (const name of ["move_candidate_stage", "add_note", "reject_application", "send_email", "delete_candidate"]) {
    assert.ok(!readOnly.includes(name), `${name} must not be offered read-only`);
  }
  assert.equal(toolsFor({ readOnly: false }).length, TOOLS.length);
});

test("the issue's tools all exist, and the destructive ones are marked", () => {
  const names = TOOLS.map((t) => t.name);
  for (const name of ["search_candidates", "get_candidate", "list_jobs", "move_candidate_stage", "add_note", "get_scorecards", "run_report", "draft_email"]) {
    assert.ok(names.includes(name), name);
  }
  assert.deepEqual(TOOLS.filter((t) => t.kind === "destructive").map((t) => t.name).sort(), ["delete_candidate", "reject_application", "send_email"]);
  for (const t of TOOLS.filter((t) => t.kind === "destructive")) assert.ok(t.input.confirm && t.preview, `${t.name} needs confirm and a preview`);
});

test("a write tool refuses to run in read-only mode even if called directly", async () => {
  const { client, calls } = fakeApi();
  const result = await callTool(tool("add_note"), { candidate_id: CAND, body: "x" }, { client, readOnly: true, redact: true });
  assert.equal(result.isError, true);
  assert.equal(calls.length, 0);
});

test("destructive tools only preview until confirm is true", async () => {
  const { client, calls } = fakeApi({
    [`GET /applications/${APP}`]: { id: APP, candidate_id: CAND, job_title: "Engineer", stage_name: "Onsite", status: "active" },
    [`GET /candidates/${CAND}`]: { id: CAND, full_name: "Ada Lovelace", applications: [] },
  });
  const opts = { client, readOnly: false, redact: true };
  const args = { application_id: APP, reason: "Not enough relevant experience" };

  const preview = await callTool(tool("reject_application"), args, opts);
  const body = JSON.parse(preview.content[0].text);
  assert.equal(body.confirmed, false);
  assert.equal(body.nothing_was_done, true);
  assert.equal(body.preview.candidate, "Ada Lovelace");
  assert.ok(calls.every((c) => c.method === "GET"), "a preview must not write");

  await callTool(tool("reject_application"), { ...args, confirm: "yes" }, opts);
  assert.ok(calls.every((c) => c.method === "GET"), "only the boolean true confirms");

  await callTool(tool("reject_application"), { ...args, confirm: true }, opts);
  const write = calls.find((c) => c.method === "POST");
  assert.equal(write?.path, `/applications/${APP}/status`);
  assert.deepEqual(write?.body, { status: "rejected", reason: args.reason });
});

test("requests carry the key and the agent label for the audit log", async () => {
  const { client, calls } = fakeApi({ "GET /me": { ok: true } });
  await callTool(tool("whoami"), {}, { client, readOnly: true, redact: false });
  assert.equal(calls[0].headers.Authorization, "Bearer pats_test");
  assert.equal(calls[0].headers["X-PennyATS-Agent"], AGENT);
  client.setAgent(`${AGENT} (claude-ai)`);
  await callTool(tool("whoami"), {}, { client, readOnly: true, redact: false });
  assert.equal(calls[1].headers["X-PennyATS-Agent"], `${AGENT} (claude-ai)`);
});

test("results are redacted, but ids and timestamps survive and the JSON stays valid", () => {
  const text = JSON.stringify(redactValue({
    id: "12345678-1234-4123-8123-123456789012",
    email: "ada@example.com",
    phone: "+1 415 555 0100",
    linkedin: "https://linkedin.com/in/ada",
    at: "2026-11-26T18:04:11.201Z",
    second: "grace@example.com",
    nested: [{ note: "Call ada@example.com or see https://example.com/profile" }],
  }));
  const out = text;
  const parsed = JSON.parse(out);
  assert.equal(parsed.linkedin, "[URL_1]");
  assert.equal(parsed.nested[0].note, "Call [EMAIL_1] or see [URL_2]");
  assert.ok(out.includes("12345678-1234-4123-8123-123456789012"));
  assert.ok(out.includes("2026-11-26T18:04:11.201Z"));
  assert.ok(!out.includes("ada@example.com"));
  assert.ok(!out.includes("555 0100"));
  assert.ok(!out.includes("linkedin.com"));
  assert.ok(out.includes("[EMAIL_1]") && out.includes("[EMAIL_2]"));
});

test("API errors come back as readable tool errors with a hint", async () => {
  const { client } = fakeApi({ "GET /reports/funnel": { __status: 403, error: { code: "missing_scope", message: "This API key needs the reports:read scope." } } });
  const result = await callTool(tool("run_report"), { report: "funnel" }, { client, readOnly: true, redact: true });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /missing_scope/);
  assert.match(result.content[0].text, /Settings > API and webhooks/);
});

test("move by stage name resolves the stage on the application's job", async () => {
  const JOB = "2c2d3e4f-0000-4000-8000-123456789012";
  const STAGE = "3c2d3e4f-0000-4000-8000-123456789012";
  const { client, calls } = fakeApi({
    [`GET /applications/${APP}`]: { id: APP, job_id: JOB },
    [`GET /jobs/${JOB}/stages`]: { data: [{ id: STAGE, name: "Onsite" }] },
  });
  const ok = await callTool(tool("move_candidate_stage"), { application_id: APP, stage_name: "onsite" }, { client, readOnly: false, redact: false });
  assert.equal(ok.isError, undefined);
  assert.deepEqual(calls.at(-1)?.body, { stage_id: STAGE });
  const bad = await callTool(tool("move_candidate_stage"), { application_id: APP, stage_name: "Offer" }, { client, readOnly: false, redact: false });
  assert.match(bad.content[0].text, /No stage named "Offer".*Onsite/);
});

test("plain JSON tool definitions are available for non-MCP agents", () => {
  const defs = toolDefinitions({ readOnly: true });
  const search = defs.find((d) => d.name === "search_candidates")!;
  assert.equal((search.input_schema as { type: string }).type, "object");
  assert.ok("query" in (search.input_schema as { properties: object }).properties);
});
