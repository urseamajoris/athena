import { test } from "node:test";
import assert from "node:assert/strict";
import { countLine, progressLine, timeLeft } from "./progress";

test("batches and papers are each said with their unit", () => {
  // Real run 3 (summary step): 2 of 27 batches written, 27 of 225 papers summarised (incl. those with no abstract).
  const p = { done: 2, total: 27, message: "Summarising the papers, 8 per batch", batches: { done: 2, total: 27 }, papers: { done: 27, total: 225 } };
  assert.equal(countLine(p), "2 of 27 batches · 27 of 225 papers");
  // Ranking: the bar has one more step (ordering topics) than the 24 batches; the line counts the batches.
  assert.equal(countLine({ done: 1, total: 25, message: "", batches: { done: 1, total: 24 } }), "1 of 24 batches");
  // A job with no batches keeps its plain count.
  assert.equal(countLine({ done: 3, total: 10, message: "Appraised 3/10" }), "3 of 10");
});

test("time left needs a pace from at least 2 batches in this run", () => {
  const base = { done: 1, total: 25, message: "", batches: { done: 1, total: 24 }, elapsedMs: 6_000, base: 0 };
  assert.equal(timeLeft(base), null);
  assert.equal(timeLeft({ ...base, batches: { done: 2, total: 24 }, elapsedMs: 12_000 }), "about 2 minutes left"); // 22 × 6 s
  assert.equal(timeLeft({ ...base, batches: { done: 16, total: 24 }, elapsedMs: 128_000 }), "about 1 minute left"); // 8 × 8 s = 64 s
  assert.equal(timeLeft({ ...base, batches: { done: 20, total: 24 }, elapsedMs: 100_000 }), "less than a minute left");
  assert.equal(timeLeft({ ...base, batches: { done: 24, total: 24 }, elapsedMs: 150_000 }), null, "nothing left once every batch is done");
  // A resumed run counts only the batches done since it started again.
  assert.equal(timeLeft({ ...base, batches: { done: 11, total: 24 }, elapsedMs: 10_000, base: 10 }), null);
  assert.equal(timeLeft({ ...base, batches: { done: 12, total: 24 }, elapsedMs: 20_000, base: 10 }), "about 2 minutes left"); // 12 × 10 s
  // No clock (a job row written before this field existed): no estimate.
  assert.equal(timeLeft({ done: 5, total: 10, message: "" }), null);
  assert.equal(progressLine({ ...base, batches: { done: 2, total: 24 }, elapsedMs: 12_000 }), "2 of 24 batches · about 2 minutes left");
});
