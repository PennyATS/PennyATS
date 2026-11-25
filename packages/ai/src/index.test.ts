import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { AiError, aiConfigFromEnv, getAiClient } from "./index";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Replace fetch, record the request, and answer like the provider would. */
function fakeFetch(reply: (body: any) => { status?: number; json?: unknown; text?: string }) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    const r = reply(body);
    return new Response(r.text ?? JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
  return calls;
}

test("AI is off unless a supported provider and key are set", () => {
  assert.equal(aiConfigFromEnv({}), null);
  assert.equal(aiConfigFromEnv({ AI_PROVIDER: "anthropic" }), null);
  assert.equal(aiConfigFromEnv({ AI_PROVIDER: "gemini", AI_API_KEY: "k" }), null);
  assert.equal(getAiClient(null), null);
  assert.deepEqual(aiConfigFromEnv({ AI_PROVIDER: "openai", AI_API_KEY: "k", AI_BASE_URL: "http://localhost:11434/v1" }), {
    provider: "openai",
    apiKey: "k",
    model: undefined,
    redactPii: true,
    baseUrl: "http://localhost:11434/v1",
  });
});

test("contact details are redacted before sending and restored in the reply", async () => {
  const calls = fakeFetch((body) => ({
    json: { content: [{ type: "text", text: `Echo: ${body.messages[0].content} / ${body.system}` }] },
  }));
  const ai = getAiClient({ provider: "anthropic", apiKey: "test-key" })!;
  const out = await ai.complete({ system: "Contact lee@example.com", prompt: "Email jordan@example.com" });

  const sent = JSON.stringify(calls[0].body);
  assert.ok(!sent.includes("@example.com"), "no email address may leave the server");
  assert.equal(calls[0].body.system, "Contact [EMAIL_1]");
  assert.equal(calls[0].body.messages[0].content, "Email [EMAIL_2]");
  assert.equal(out, "Echo: Email jordan@example.com / Contact lee@example.com");
  assert.equal(calls[0].url, "https://api.anthropic.com/v1/messages");
  assert.equal(calls[0].headers["x-api-key"], "test-key");
});

test("redaction can be turned off", async () => {
  const calls = fakeFetch(() => ({ json: { choices: [{ message: { content: "ok" } }] } }));
  const ai = getAiClient({ provider: "openai", apiKey: "k", redactPii: false })!;
  await ai.complete({ prompt: "Email jordan@example.com" });
  assert.equal(calls[0].body.messages[0].content, "Email jordan@example.com");
});

test("a custom base URL is used for OpenAI-compatible servers", async () => {
  const calls = fakeFetch(() => ({ json: { choices: [{ message: { content: "hi" } }] } }));
  const ai = getAiClient({ provider: "openai", apiKey: "k", baseUrl: "http://localhost:11434/v1/" })!;
  assert.equal(await ai.complete({ prompt: "hello" }), "hi");
  assert.equal(calls[0].url, "http://localhost:11434/v1/chat/completions");
});

test("provider errors become user-safe AiErrors", async () => {
  fakeFetch(() => ({ status: 401, text: '{"error":"invalid x-api-key"}' }));
  const ai = getAiClient({ provider: "anthropic", apiKey: "bad" })!;
  await assert.rejects(ai.complete({ prompt: "hi" }), (err: unknown) => {
    assert.ok(err instanceof AiError);
    assert.equal(err.message, "The AI provider rejected the API key.");
    assert.equal(err.status, 401);
    return true;
  });
});
