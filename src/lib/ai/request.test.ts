import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import Anthropic from "@anthropic-ai/sdk";
import { explainSdkError, listModels, parseEffort, sdkClient, sendStructured, supportsRefusalFallback, type ModelRequest } from "./request";
import { costOf } from "./cost";

// A local stand-in for the API's HTTP surface, for these tests only: it records what the client sends and plays
// back scripted responses. Nothing here reaches the network, and no key is real.

const KEY = "sk-ant-test-0123456789abcdefTESTKEY";
interface Seen { method: string; url: string; headers: http.IncomingHttpHeaders; body: Record<string, unknown> | null }
type Scripted = (res: http.ServerResponse) => void;

let server: http.Server;
let base = "";
let seen: Seen[] = [];
let script: Scripted[] = [];

const USAGE = { input_tokens: 1200, cache_creation_input_tokens: 0, cache_read_input_tokens: 800, output_tokens: 1 };

/** A streamed message: the events the API sends for one answer. */
function sse(opts: { text?: string; stop?: string; model?: string; stopDetails?: unknown; outputTokens?: number; usage?: Record<string, unknown>; content?: unknown[] } = {}): Scripted {
  return (res) => {
    const model = opts.model ?? "claude-opus-5-5";
    const events: [string, unknown][] = [["message_start", { type: "message_start", message: { id: "msg_test", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, stop_details: null, usage: USAGE } }]];
    const blocks = opts.content ?? (opts.text === undefined ? [] : [{ type: "text", text: opts.text }]);
    blocks.forEach((b, index) => {
      const block = b as { type: string; text?: string };
      if (block.type === "text") {
        events.push(["content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } }]);
        const half = Math.ceil((block.text ?? "").length / 2);
        for (const part of [block.text!.slice(0, half), block.text!.slice(half)]) events.push(["content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: part } }]);
      } else events.push(["content_block_start", { type: "content_block_start", index, content_block: block }]);
      events.push(["content_block_stop", { type: "content_block_stop", index }]);
    });
    events.push(["message_delta", { type: "message_delta", delta: { stop_reason: opts.stop ?? "end_turn", stop_sequence: null, stop_details: opts.stopDetails ?? null }, usage: { output_tokens: opts.outputTokens ?? 40, ...(opts.usage ?? {}) } }]);
    events.push(["message_stop", { type: "message_stop" }]);
    res.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_test" });
    res.end(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(""));
  };
}

function apiError(status: number, type: string, message: string, headers: Record<string, string> = {}): Scripted {
  return (res) => {
    res.writeHead(status, { "content-type": "application/json", "request-id": "req_test", ...headers });
    res.end(JSON.stringify({ type: "error", error: { type, message }, request_id: "req_test" }));
  };
}

const req = (over: Partial<ModelRequest> = {}): ModelRequest => ({
  apiKey: KEY,
  baseUrl: base,
  model: "claude-opus-5-5",
  system: "You are a careful assistant.",
  messages: [{ role: "user", content: "Say hello." }],
  schema: { type: "object", properties: { greeting: { type: "string" } }, required: ["greeting"], additionalProperties: false },
  effort: "low",
  maxTokens: 64_000,
  ...over,
});

before(async () => {
  server = http.createServer((q, res) => {
    let raw = "";
    q.on("data", (c) => (raw += c));
    q.on("end", () => {
      seen.push({ method: q.method ?? "", url: q.url ?? "", headers: q.headers, body: raw ? JSON.parse(raw) : null });
      const next = script.shift();
      if (next) next(res);
      else apiError(500, "api_error", "the test did not script this request")(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  seen = [];
  script = [];
});

test("the client uses only the key and base URL it is given, never the SDK's own environment lookup", () => {
  const saved = { ...process.env };
  process.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:1/somewhere-else";
  process.env.ANTHROPIC_API_KEY = "sk-ant-from-the-environment-000000";
  process.env.ANTHROPIC_AUTH_TOKEN = "token-from-the-environment-000000";
  try {
    const c = sdkClient(KEY, "https://api.anthropic.com");
    assert.equal(c.baseURL, "https://api.anthropic.com");
    assert.equal(c.apiKey, KEY);
    assert.equal(c.authToken, null);
    assert.equal(c.maxRetries, 4);
    assert.equal(sdkClient(KEY, "https://api.anthropic.com"), c, "one client per key and base URL");
    assert.notEqual(sdkClient("sk-ant-another-key-0000000000", "https://api.anthropic.com"), c, "rebuilt when the key changes");
    assert.throws(() => sdkClient("", "https://api.anthropic.com"), /needs an API key/, "no key: no client, so the SDK cannot go looking for one");
  } finally {
    for (const k of ["ANTHROPIC_BASE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"]) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test("effort setting: a level, empty for none, anything else falls back", () => {
  assert.equal(parseEffort(undefined, "low"), "low");
  assert.equal(parseEffort("", "low"), null);
  assert.equal(parseEffort(" High ", "low"), "high");
  assert.equal(parseEffort("xhigh", "medium"), "xhigh");
  assert.equal(parseEffort("extreme", "medium"), "medium");
});

test("a request: streamed, schema-constrained, effort set, system block cacheable, no thinking budget, no tools", async () => {
  script.push(sse({ text: '{"greeting":"hello"}', outputTokens: 55, usage: { output_tokens_details: { thinking_tokens: 30 } } }));
  const r = await sendStructured(req());
  assert.equal(r.stopReason, "end_turn");
  assert.equal(r.text, '{"greeting":"hello"}');
  assert.equal(r.model, "claude-opus-5-5");
  assert.equal(r.refusalCategory, null);
  assert.deepEqual(r.declined, []);
  assert.deepEqual(costOf("claude-opus-5-5", r.usage), { inputTokens: 2000, cachedTokens: 800, outputTokens: 55, reasoningTokens: 30, costUsd: (1200 * 4 + 800 * 0.2 + 55 * 20) / 1e6 });

  assert.equal(seen.length, 1);
  const { method, url, headers, body } = seen[0];
  assert.equal(method, "POST");
  assert.match(url, /^\/v1\/messages/);
  assert.ok(String(headers.authorization ?? headers["x-api-key"]).includes(KEY), "the key given is the credential sent");
  assert.equal(body!.stream, true);
  assert.equal(body!.model, "claude-opus-5-5");
  assert.equal(body!.max_tokens, 64_000);
  assert.deepEqual(body!.system, [{ type: "text", text: "You are a careful assistant.", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(body!.messages, [{ role: "user", content: "Say hello." }]);
  assert.deepEqual(body!.output_config, { effort: "low", format: { type: "json_schema", schema: req().schema } });
  for (const k of ["thinking", "tools", "tool_choice", "temperature", "top_p", "top_k"]) assert.ok(!(k in body!), `${k} is not sent`);
});

test("a declined request: models that support it ask the API to re-run it on another model", async () => {
  assert.equal(supportsRefusalFallback("claude-opus-5-5"), true);
  assert.equal(supportsRefusalFallback("claude-sonnet-5-5"), true);
  assert.equal(supportsRefusalFallback("claude-haiku-5-5"), false);
  assert.equal(supportsRefusalFallback("claude-opus-4-8"), false);

  script.push(sse({ text: "{}" }), sse({ text: "{}", model: "claude-haiku-5-5" }));
  await sendStructured(req());
  await sendStructured(req({ model: "claude-haiku-5-5" }));
  assert.equal(seen[0].body!.fallbacks, "default");
  assert.match(String(seen[0].headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.ok(!("fallbacks" in seen[1].body!), "not sent for a model without server-side fallbacks");
  assert.equal(seen[1].headers["anthropic-beta"], undefined);
  assert.ok(!("betas" in seen[0].body!), "the beta flag travels as a header, not in the body");
});

test("an answer from the fallback model: its text is read past the switch marker, and both runs are costed", async () => {
  const iterations = [
    { type: "message", model: "claude-opus-5-5", input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 },
    { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 },
  ];
  script.push(sse({ content: [{ type: "fallback", from: { model: "claude-opus-5-5" }, to: { model: "claude-opus-4-8" }, trigger: { type: "refusal", category: "bio" } }, { type: "text", text: '{"greeting":"hi"}' }], outputTokens: 20, usage: { input_tokens: 1000, iterations } }));
  const r = await sendStructured(req());
  assert.equal(r.stopReason, "end_turn");
  assert.equal(r.text, '{"greeting":"hi"}');
  assert.equal(r.model, "claude-opus-4-8", "the model that produced the answer");
  assert.deepEqual(r.declined, ["bio"], "the first run declined, in a category that is billed");
  const c = costOf("claude-opus-5-5", r.usage, undefined, r.declined);
  assert.equal(c.inputTokens, 2000);
  assert.ok(Math.abs(c.costUsd - ((1000 * 4) / 1e6 + (1000 * 5 + 20 * 25) / 1e6)) < 1e-12);
});

test("a refusal is reported by its stop reason, with the category and no text", async () => {
  script.push(sse({ stop: "refusal", stopDetails: { type: "refusal", category: "cyber", explanation: "declined" }, outputTokens: 0 }));
  const r = await sendStructured(req());
  assert.equal(r.stopReason, "refusal");
  assert.equal(r.refusalCategory, "cyber");
  assert.deepEqual(r.declined, ["cyber"]);
  assert.equal(r.text, "");
  assert.equal(costOf("claude-opus-5-5", r.usage, undefined, r.declined).costUsd, 0, "declined before any output, in a category that is not billed");
});

test("an answer cut off at the length limit is reported by its stop reason, with the partial text", async () => {
  script.push(sse({ text: '{"greeting":"hel', stop: "max_tokens", outputTokens: 64_000 }));
  const r = await sendStructured(req());
  assert.equal(r.stopReason, "max_tokens");
  assert.equal(r.text, '{"greeting":"hel');
});

test("a model that rejects the effort level is asked again without it, and that is remembered", async () => {
  const model = "claude-haiku-4-5";
  script.push(apiError(400, "invalid_request_error", "output_config.effort: this model does not support the effort parameter"), sse({ text: "{}", model }), sse({ text: "{}", model }));
  const r = await sendStructured(req({ model }));
  assert.equal(r.text, "{}");
  assert.deepEqual(seen.map((s) => (s.body!.output_config as { effort?: string }).effort), ["low", undefined]);
  await sendStructured(req({ model }));
  assert.equal((seen[2].body!.output_config as { effort?: string }).effort, undefined, "left out from then on for that model");
  assert.ok((seen[2].body!.output_config as { format?: unknown }).format, "the schema is still sent");
});

test("an API that rejects the fallback option is asked again without it, and that is remembered", async () => {
  const model = "claude-fable-5-2";
  script.push(apiError(400, "invalid_request_error", "Unexpected value(s) `server-side-fallback-2026-07-01` for the `anthropic-beta` header."), sse({ text: "{}", model }), sse({ text: "{}", model }));
  await sendStructured(req({ model }));
  assert.equal(seen[0].body!.fallbacks, "default");
  assert.ok(!("fallbacks" in seen[1].body!));
  assert.equal((seen[1].body!.output_config as { effort?: string }).effort, "low", "only the rejected option is dropped");
  await sendStructured(req({ model }));
  assert.ok(!("fallbacks" in seen[2].body!));
});

test("another bad request is not retried and gives a plain message", async () => {
  script.push(apiError(400, "invalid_request_error", "messages: at least one message is required"));
  await assert.rejects(sendStructured(req({ model: "claude-sonnet-5-5" })), (e: Error) => {
    assert.equal(e.constructor, Error, "a plain Error, not the SDK's error object");
    assert.equal(e.message, "The AI service did not accept the request. Details: messages: at least one message is required");
    return true;
  });
  assert.equal(seen.length, 1);
});

test("a rejected key: a plain message that never contains the key, and the SDK error is not passed on", async () => {
  script.push(apiError(401, "authentication_error", `invalid x-api-key ${KEY}`, { "x-echo": KEY }));
  await assert.rejects(sendStructured(req()), (e: Error) => {
    assert.equal(e.constructor, Error);
    assert.ok(!(e instanceof Anthropic.APIError));
    assert.equal(e.message, "The AI service did not accept the API key: it is wrong, revoked or expired. An administrator can replace it in the dashboard.");
    assert.ok(!JSON.stringify({ ...e, m: e.message, s: e.stack }).includes(KEY));
    assert.equal((e as { headers?: unknown }).headers, undefined);
    return true;
  });
  assert.equal(seen.length, 1, "a rejected key is not retried");
});

test("a busy service is retried by the SDK and the answer still arrives", async () => {
  script.push(apiError(529, "overloaded_error", "Overloaded", { "retry-after-ms": "5" }), apiError(429, "rate_limit_error", "slow down", { "retry-after-ms": "5" }), sse({ text: '{"greeting":"hello"}' }));
  const r = await sendStructured(req());
  assert.equal(r.text, '{"greeting":"hello"}');
  assert.equal(seen.length, 3);
});

test("the models list: IDs, family, release date and effort levels", async () => {
  const cap = (supported: boolean) => ({ supported });
  script.push((res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        data: [
          { type: "model", id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-10-01T00:00:00Z", lifecycle: "active", line: "opus", capabilities: { effort: { supported: true, low: cap(true), medium: cap(true), high: cap(true), xhigh: cap(true), max: cap(true) } } },
          { type: "model", id: "claude-haiku-4-5-20251001", display_name: "Claude Haiku 4.5", created_at: "2025-10-01T00:00:00Z", lifecycle: "active", line: "haiku", capabilities: { effort: { supported: false, low: cap(false), medium: cap(false), high: cap(false), xhigh: null, max: cap(false) } } },
          { type: "model", id: "claude-old", display_name: "Old", created_at: "2024-01-01T00:00:00Z", lifecycle: "retired", line: null, capabilities: null },
        ],
        has_more: false,
        first_id: "claude-opus-5-5",
        last_id: "claude-old",
      }),
    );
  });
  const models = await listModels(KEY, base);
  assert.deepEqual(models, [
    { id: "claude-opus-5-5", line: "opus", createdAt: "2026-10-01T00:00:00Z", retired: false, efforts: ["low", "medium", "high", "xhigh", "max"] },
    { id: "claude-haiku-4-5-20251001", line: "haiku", createdAt: "2025-10-01T00:00:00Z", retired: false, efforts: [] },
    { id: "claude-old", line: null, createdAt: "2024-01-01T00:00:00Z", retired: true, efforts: null },
  ]);
  assert.equal(seen[0].method, "GET");
  assert.match(seen[0].url, /^\/v1\/models/);
});

test("SDK errors become short plain messages, most specific first, with secrets removed", () => {
  const headers = new Headers({ "x-secret": KEY });
  const make = (status: number, type: string, message: string) => Anthropic.APIError.generate(status, { type: "error", error: { type, message } }, undefined, headers);
  const say = (e: unknown) => explainSdkError(e, [KEY]);
  assert.match(say(make(401, "authentication_error", "invalid x-api-key")), /did not accept the API key/);
  assert.match(say(make(403, "permission_error", "not allowed")), /^The API key is not allowed to do this\..* Details: not allowed$/);
  assert.match(say(make(404, "not_found_error", "model: claude-nope")), /^The AI model was not found, or this API key cannot use it\..* Details: model: claude-nope$/);
  assert.equal(say(make(429, "rate_limit_error", "rate limited")), "The AI service is receiving too many requests right now. Wait a minute, then try again.");
  assert.equal(say(make(413, "request_too_large", "too big")), "The text is too long for the AI to read in one go.");
  assert.equal(say(make(400, "invalid_request_error", `bad field near ${KEY}`)), "The AI service did not accept the request. Details: bad field near [redacted]");
  assert.equal(say(make(402, "billing_error", "no credit")), "The AI service account has a billing problem. An administrator needs to check it.");
  assert.equal(say(make(500, "api_error", "boom")), "The AI service is busy or having problems right now. Try again in a few minutes.");
  assert.equal(say(make(529, "overloaded_error", "Overloaded")), "The AI service is busy or having problems right now. Try again in a few minutes.");
  assert.equal(say(make(409, "conflict", "hmm")), "The AI service returned an error (HTTP 409). Details: hmm");
  assert.equal(say(new Anthropic.APIConnectionError({ message: "Connection error.", cause: new Error(`connect ECONNREFUSED with ${KEY}`) })), "Could not reach the AI service. Check the server's network connection, then try again.");
  assert.equal(say(new Anthropic.APIConnectionTimeoutError()), "The AI service took too long to answer. Try again in a moment.");
  assert.equal(say(new Anthropic.APIUserAbortError()), "The AI took too long to finish its answer, so the request was stopped. Try again.");
  assert.match(say(new Anthropic.AnthropicError("request ended without sending any chunks")), /did not return a complete answer/);
  assert.equal(say(new Error(`plain ${KEY}`)), "plain [redacted]");
  for (const status of [400, 401, 403, 404, 409, 413, 429, 500]) assert.ok(!say(make(status, "x", "y")).includes(KEY), `HTTP ${status}: headers never reach the message`);
});
