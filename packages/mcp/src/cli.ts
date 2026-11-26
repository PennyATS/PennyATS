#!/usr/bin/env -S npx tsx
/**
 * pennyats-mcp: an MCP server for PennyATS.
 *
 *   PENNYATS_URL=https://ats.example.com PENNYATS_API_KEY=pats_... pennyats-mcp            (stdio)
 *   PENNYATS_URL=https://ats.example.com pennyats-mcp --http --port 3333                    (streamable HTTP)
 *
 * Read-only unless --read-write (or PENNYATS_MCP_READ_WRITE=true). Contact details are redacted
 * from results unless --no-redact (or PENNYATS_MCP_REDACT=false).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PennyClient } from "./client.js";
import { startHttpServer } from "./http.js";
import { AGENT, createPennyServer, VERSION } from "./server.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const envTrue = (name: string) => /^(1|true|yes|on)$/i.test(process.env[name] ?? "");
const envFalse = (name: string) => /^(0|false|no|off)$/i.test(process.env[name] ?? "");

if (flag("help") || flag("h")) {
  console.error(`pennyats-mcp ${VERSION}

Environment:
  PENNYATS_URL              Your PennyATS address, e.g. https://ats.example.com (required)
  PENNYATS_API_KEY          API key from Settings > API and webhooks (required for stdio)
  PENNYATS_MCP_READ_WRITE   true to offer write tools (default: read-only)
  PENNYATS_MCP_REDACT       false to stop redacting emails, phones, and links (default: on)

Flags:
  --read-write    Offer write tools. Destructive ones still need confirm: true.
  --no-redact     Don't redact contact details in results.
  --http          Serve streamable HTTP at /mcp instead of stdio. Each request sends its own key.
  --port <n>      HTTP port (default 3333)
  --host <h>      HTTP host (default 127.0.0.1)`);
  process.exit(0);
}

const baseUrl = process.env.PENNYATS_URL;
if (!baseUrl) {
  console.error("Set PENNYATS_URL to your PennyATS address, e.g. https://ats.example.com");
  process.exit(1);
}
const readOnly = !(flag("read-write") || envTrue("PENNYATS_MCP_READ_WRITE"));
const redact = !(flag("no-redact") || envFalse("PENNYATS_MCP_REDACT"));

if (flag("http")) {
  const port = Number(option("port") ?? process.env.PORT ?? 3333);
  const host = option("host") ?? "127.0.0.1";
  await startHttpServer({ baseUrl, readOnly, redact, port, host });
  console.error(`pennyats-mcp ${VERSION} listening on http://${host}:${port}/mcp (${readOnly ? "read-only" : "read-write"}${redact ? ", redacting contact details" : ""})`);
} else {
  const apiKey = process.env.PENNYATS_API_KEY;
  if (!apiKey) {
    console.error("Set PENNYATS_API_KEY to a key from PennyATS Settings > API and webhooks.");
    process.exit(1);
  }
  const client = new PennyClient({ baseUrl, apiKey, agent: AGENT });
  const server = createPennyServer({ client, readOnly, redact });
  await server.connect(new StdioServerTransport());
  // stdout carries the protocol, so status goes to stderr.
  console.error(`pennyats-mcp ${VERSION} on stdio (${readOnly ? "read-only" : "read-write"}${redact ? ", redacting contact details" : ""})`);
}
