import { test } from "node:test";
import assert from "node:assert/strict";
import { AiPausedError, AiUnavailableError, BudgetError, aiRefusal, isAiStop } from "./errors";
import { PROVIDER_META, estimateProviderCost, isAiProvider } from "../shared/ai-providers";

test("no key: the call is refused before it is sent, logged as paused, and stops the job like the AI switch", () => {
  const r = aiRefusal({ enabled: true, key: "" });
  assert.ok(r);
  assert.deepEqual(r.row, { status: "paused", error: "no xAI API key configured" });
  assert.ok(r.error instanceof AiUnavailableError);
  assert.ok(r.error instanceof AiPausedError, "pauses the job and answers 503 ai_paused, like the switch");
  assert.equal(isAiStop(r.error), true);
  assert.equal(r.error.message, "AI is not set up on this server yet: no xAI API key is configured. An administrator can add one in the dashboard. Your work is saved.");
});

test("provider-specific refusal messages for Anthropic and Gemini", () => {
  const ant = aiRefusal({ enabled: true, key: "", provider: "anthropic" });
  assert.deepEqual(ant?.row, { status: "paused", error: "no Anthropic API key configured" });
  assert.match(ant!.error.message, /no Anthropic API key is configured/);

  const gem = aiRefusal({ enabled: true, key: "", provider: "gemini" });
  assert.deepEqual(gem?.row, { status: "paused", error: "no Gemini API key configured" });
  assert.match(gem!.error.message, /no Gemini API key is configured/);
});

test("provider catalog and pricing estimates for Anthropic, Gemini and xAI", () => {
  assert.equal(isAiProvider("anthropic"), true);
  assert.equal(isAiProvider("gemini"), true);
  assert.equal(isAiProvider("xai"), true);
  assert.equal(isAiProvider("unknown"), false);
  assert.ok(PROVIDER_META.anthropic.catalog.length >= 3);
  assert.ok(PROVIDER_META.gemini.catalog.length >= 3);
  assert.ok(estimateProviderCost("anthropic", "claude-sonnet-4-6", 1_000_000, 0, 0) === 3);
  assert.ok(estimateProviderCost("gemini", "gemini-2.5-flash", 1_000_000, 0, 0) === 0.15);
});

test("AI switched off is reported first, with or without a key", () => {
  for (const key of ["", "xai-real-looking-key"]) {
    const r = aiRefusal({ enabled: false, key });
    assert.deepEqual(r?.row, { status: "paused", error: "AI switched off by an administrator" });
    assert.ok(r?.error instanceof AiPausedError);
    assert.ok(!(r?.error instanceof AiUnavailableError));
    assert.match(r!.error.message, /paused by the administrator/);
  }
});

test("a key with AI on lets the call go ahead (the budget is checked next)", () => {
  assert.equal(aiRefusal({ enabled: true, key: "xai-real-looking-key" }), null);
  assert.equal(isAiStop(new BudgetError("budget reached")), true);
  assert.equal(isAiStop(new Error("network")), false);
});
