/**
 * A small client for the PennyATS public API (/api/v1). The MCP server only talks to PennyATS
 * through this, with a scoped API key, so it gets exactly the access that key has and every
 * write lands in the audit log. No database access, no shortcuts.
 */

export type ApiErrorBody = { error: { code: string; message: string; details?: unknown } };

export class PennyApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export type ClientOptions = {
  /** Base URL of the PennyATS instance, e.g. https://ats.example.com */
  baseUrl: string;
  apiKey: string;
  /** Sent as X-PennyATS-Agent so writes show as agent activity in the audit log. */
  agent: string;
  fetch?: typeof fetch;
};

type Query = Record<string, string | number | undefined | null>;

export class PennyClient {
  private base: string;
  private doFetch: typeof fetch;

  constructor(private opts: ClientOptions) {
    this.base = `${opts.baseUrl.replace(/\/+$/, "")}/api/v1`;
    this.doFetch = opts.fetch ?? fetch;
  }

  /** Change the agent label, e.g. once the MCP client has said who it is. */
  setAgent(agent: string) {
    this.opts.agent = agent;
  }

  async request<T = any>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, opts: { query?: Query; body?: unknown } = {}): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    const url = `${this.base}${path}${qs.size ? `?${qs}` : ""}`;
    const res = await this.doFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.opts.apiKey}`,
        "X-PennyATS-Agent": this.opts.agent,
        ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: a proxy error page or similar.
    }
    if (!res.ok) {
      const err = (json as ApiErrorBody | null)?.error;
      throw new PennyApiError(res.status, err?.code ?? "http_error", err?.message ?? `PennyATS returned HTTP ${res.status}.`, err?.details);
    }
    return json as T;
  }

  get<T = any>(path: string, query?: Query) {
    return this.request<T>("GET", path, { query });
  }
  post<T = any>(path: string, body: unknown) {
    return this.request<T>("POST", path, { body });
  }
  delete<T = any>(path: string) {
    return this.request<T>("DELETE", path);
  }
}

/** Path segment, encoded. Ids come from the model, so never trust them in a URL as-is. */
export const seg = (value: string) => encodeURIComponent(value);
