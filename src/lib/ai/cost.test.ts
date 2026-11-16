import { test } from "node:test";
import assert from "node:assert/strict";
import { MODEL_PRICES, costOf, priceFor } from "./cost";

const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} is not ${b}`);

test("prices: the four current models are listed, per million tokens", () => {
  assert.deepEqual(MODEL_PRICES["claude-opus-5-5"], { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 });
  assert.deepEqual(MODEL_PRICES["claude-sonnet-5-5"], { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 });
  assert.deepEqual(MODEL_PRICES["claude-fable-5-2"], { input: 8, cacheWrite: 10, cacheRead: 0.2, output: 40 });
  assert.equal(MODEL_PRICES["claude-haiku-5-5"].input, 0.1);
  assert.equal(MODEL_PRICES["claude-haiku-5-5"].output, 0.5);
  for (const [id, p] of Object.entries(MODEL_PRICES)) assert.equal(p.cacheWrite, p.input * 1.25, `${id}: a 5-minute cache write is 1.25 x input`);
});

test("an unknown model is costed at the Opus 5.5 rates; a dated ID uses its base model", () => {
  assert.equal(priceFor("some-future-model"), MODEL_PRICES["claude-opus-5-5"]);
  assert.equal(priceFor("claude-opus-5-5-20260101"), MODEL_PRICES["claude-opus-5-5"]);
  assert.equal(priceFor("claude-opus-5-20260101"), MODEL_PRICES["claude-opus-5"]);
  assert.equal(priceFor("claude-sonnet-5-5"), MODEL_PRICES["claude-sonnet-5-5"]);
});

test("cost: uncached, cache-write, cache-read and output tokens each at their own rate", () => {
  const c = costOf("claude-opus-5-5", { input_tokens: 1_000, cache_creation_input_tokens: 2_000, cache_read_input_tokens: 3_000, output_tokens: 500, output_tokens_details: { thinking_tokens: 120 } });
  assert.equal(c.inputTokens, 6_000, "all prompt tokens: uncached + cache write + cache read");
  assert.equal(c.cachedTokens, 3_000, "cache reads only");
  assert.equal(c.outputTokens, 500);
  assert.equal(c.reasoningTokens, 120);
  near(c.costUsd, (1_000 * 4 + 2_000 * 5 + 3_000 * 0.2 + 500 * 20) / 1e6);
  near(costOf("claude-opus-5-5", { input_tokens: 1_000_000, output_tokens: 0 }).costUsd, 4);
  near(costOf("claude-opus-5-5", { input_tokens: 0, output_tokens: 1_000_000 }).costUsd, 20);
});

test("cost: missing or null fields count as zero; no usage costs nothing", () => {
  const c = costOf("claude-sonnet-5-5", { input_tokens: 10, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null, output_tokens_details: null, iterations: null });
  assert.deepEqual({ ...c, costUsd: 0 }, { inputTokens: 10, cachedTokens: 0, outputTokens: 20, reasoningTokens: 0, costUsd: 0 });
  near(c.costUsd, (10 * 2 + 20 * 10) / 1e6);
  assert.deepEqual(costOf("claude-opus-5-5", null), { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 });
});

test("cost: Haiku 5.5 charges more once the whole prompt passes 100,000 tokens", () => {
  near(costOf("claude-haiku-5-5", { input_tokens: 100_000, output_tokens: 1_000 }).costUsd, (100_000 * 0.1 + 1_000 * 0.5) / 1e6);
  near(costOf("claude-haiku-5-5", { input_tokens: 60_000, cache_read_input_tokens: 50_000, output_tokens: 1_000 }).costUsd, (60_000 * 0.5 + 50_000 * 0.05 + 1_000 * 2.5) / 1e6);
});

test("cost: a request re-run on another model is the sum of its runs, each at its own model's rates", () => {
  const c = costOf("claude-opus-5-5", {
    // The top-level counts cover only the run that produced the answer.
    input_tokens: 900,
    output_tokens: 300,
    output_tokens_details: { thinking_tokens: 50 },
    iterations: [
      { type: "message", model: null, input_tokens: 1_000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 },
      { type: "fallback_message", model: "claude-opus-4-8", input_tokens: 900, cache_creation_input_tokens: 0, cache_read_input_tokens: 100, output_tokens: 300 },
      { type: "compaction", input_tokens: 5_000, output_tokens: 5_000 },
    ],
  });
  assert.equal(c.inputTokens, 2_000);
  assert.equal(c.cachedTokens, 100);
  assert.equal(c.outputTokens, 310);
  assert.equal(c.reasoningTokens, 50);
  near(c.costUsd, (1_000 * 4 + 10 * 20) / 1e6 + (900 * 5 + 100 * 0.5 + 300 * 25) / 1e6);
});
