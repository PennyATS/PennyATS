/**
 * Streamable HTTP transport, stateless: every request carries its own PennyATS API key in
 * `Authorization: Bearer <key>`, and gets a fresh server with a client for that key. The server
 * holds no key of its own in this mode, so reaching the port grants nothing by itself.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PennyClient } from "./client.js";
import { AGENT, createPennyServer } from "./server.js";

export type HttpOptions = {
  baseUrl: string;
  readOnly: boolean;
  redact: boolean;
  port: number;
  host: string;
};

const MAX_BODY = 1024 * 1024;

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large."));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined);
      } catch {
        reject(new Error("Body must be JSON."));
      }
    });
    req.on("error", reject);
  });
}

function jsonRpcError(res: import("node:http").ServerResponse, status: number, message: string) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

export function startHttpServer(opts: HttpOptions): Promise<Server> {
  const http = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/mcp") return jsonRpcError(res, 404, "Not found. The MCP endpoint is /mcp.");
    if (req.method !== "POST") return jsonRpcError(res, 405, "Method not allowed. This server is stateless; use POST.");
    const key = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? "")?.[1];
    if (!key) {
      res.setHeader("WWW-Authenticate", 'Bearer realm="pennyats"');
      return jsonRpcError(res, 401, "Send your PennyATS API key as Authorization: Bearer <key>.");
    }
    let body: unknown;
    try {
      body = await readBody(req);
    } catch (err) {
      return jsonRpcError(res, 400, err instanceof Error ? err.message : "Bad request.");
    }
    const client = new PennyClient({ baseUrl: opts.baseUrl, apiKey: key, agent: AGENT });
    const server = createPennyServer({ client, readOnly: opts.readOnly, redact: opts.redact });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("MCP request failed:", err instanceof Error ? err.message : err);
      if (!res.headersSent) jsonRpcError(res, 500, "Internal error.");
    }
  });
  return new Promise((resolve) => http.listen(opts.port, opts.host, () => resolve(http)));
}
