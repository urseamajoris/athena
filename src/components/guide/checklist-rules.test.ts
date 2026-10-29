import { test } from "node:test";
import assert from "node:assert/strict";
import { appraisalChecks, keepRuleDone } from "./checklist-rules";

test("ranking: 'Keep 3–5 papers per topic' is not done before the ranking has scores, or while it runs", () => {
  // No scores yet: every topic has 0 selected and 0 spare, so none is "short" or "over".
  assert.equal(keepRuleDone({ ranked: false, running: true, topics: 4, short: 0, over: 0 }), false);
  assert.equal(keepRuleDone({ ranked: false, running: false, topics: 4, short: 0, over: 0 }), false);
  assert.equal(keepRuleDone({ ranked: true, running: true, topics: 4, short: 0, over: 0 }), false);
  assert.equal(keepRuleDone({ ranked: true, running: false, topics: 4, short: 1, over: 0 }), false);
  assert.equal(keepRuleDone({ ranked: true, running: false, topics: 4, short: 0, over: 0 }), true);
});

test("appraisal: nothing is done while the papers are still being appraised (0 of 11 looked at, 0 left)", () => {
  const running = Array.from({ length: 11 }, (_, i) => ({ id: `a${i}`, status: "running" }));
  assert.deepEqual(appraisalChecks({ running: true, appraisals: running, reviewed: [], undecided: 0 }), { looked: false, decided: false });
  assert.deepEqual(appraisalChecks({ running: false, appraisals: [], reviewed: [], undecided: 0 }), { looked: false, decided: false });
});

test("appraisal: done once finished and really true", () => {
  const apps = [{ id: "a", status: "done" }, { id: "b", status: "done" }, { id: "c", status: "failed" }];
  assert.deepEqual(appraisalChecks({ running: false, appraisals: apps, reviewed: ["a"], undecided: 2 }), { looked: false, decided: false });
  // Nothing to decide, and it truly is nothing: the appraisal finished.
  assert.deepEqual(appraisalChecks({ running: false, appraisals: apps, reviewed: ["a", "b"], undecided: 0 }), { looked: true, decided: true });
  // Every appraisal failed: nothing was looked at.
  assert.equal(appraisalChecks({ running: false, appraisals: [{ id: "c", status: "failed" }], reviewed: [], undecided: 0 }).looked, false);
});
