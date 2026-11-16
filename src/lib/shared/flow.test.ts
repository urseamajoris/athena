import test from "node:test";
import assert from "node:assert/strict";
import { STEPS, PHASES, STEP_BY_KEY, activeStage, currentStep, progress, stepForStage, stepStatus } from "./flow";
import type { StageState } from "./stages";

const states = (s: Partial<Record<number, StageState>>) => Object.fromEntries(Array.from({ length: 9 }, (_, i) => [String(i + 1), s[i + 1] ?? "not_started"]));

test("every engine stage 1-9 belongs to exactly one screen, in order", () => {
  assert.deepEqual(STEPS.flatMap((s) => s.stages), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (let n = 1; n <= 9; n++) assert.ok(stepForStage(n).stages.includes(n));
  assert.equal(PHASES.length, 4);
  for (const s of STEPS) assert.ok(PHASES.some((p) => p.key === s.phase));
});

test("a new project is on the idea screen and everything after it is locked", () => {
  const st = states({ 1: "needs_review" });
  assert.equal(currentStep(st).key, "idea");
  assert.equal(stepStatus(STEP_BY_KEY.idea, st), "review");
  assert.equal(stepStatus(STEP_BY_KEY.question, st), "locked");
  assert.equal(stepStatus(STEP_BY_KEY.report, st), "locked");
});

test("the next screen unlocks when the one before is confirmed", () => {
  const st = states({ 1: "approved" });
  assert.equal(stepStatus(STEP_BY_KEY.question, st), "todo");
  assert.equal(currentStep(st).key, "question");
  assert.equal(stepStatus(STEP_BY_KEY.search, st), "locked");
});

test("choose covers summaries then ranking", () => {
  const base = { 1: "approved", 2: "approved", 3: "approved", 4: "approved" } as const;
  assert.equal(stepStatus(STEP_BY_KEY.choose, states({ ...base, 5: "running" })), "working");
  assert.equal(activeStage(STEP_BY_KEY.choose, states({ ...base, 5: "running" })), 5);
  assert.equal(stepStatus(STEP_BY_KEY.choose, states({ ...base, 5: "approved", 6: "running" })), "working");
  assert.equal(stepStatus(STEP_BY_KEY.choose, states({ ...base, 5: "approved", 6: "needs_review" })), "review");
  assert.equal(activeStage(STEP_BY_KEY.choose, states({ ...base, 5: "approved", 6: "needs_review" })), 6);
  assert.equal(stepStatus(STEP_BY_KEY.choose, states({ ...base, 5: "approved", 6: "approved" })), "done");
  assert.equal(stepStatus(STEP_BY_KEY.choose, states({ ...base, 5: "approved" })), "review");
});

test("failed and stale show before review", () => {
  const base = { 1: "approved", 2: "approved", 3: "approved" } as const;
  assert.equal(stepStatus(STEP_BY_KEY.found, states({ ...base, 4: "failed" })), "failed");
  assert.equal(stepStatus(STEP_BY_KEY.found, states({ ...base, 4: "stale" })), "stale");
});

test("progress counts finished screens; a finished review stays on the last screen", () => {
  const all = states(Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, "approved"])) as Record<number, StageState>);
  assert.deepEqual(progress(all), { done: 8, total: 8 });
  assert.equal(currentStep(all).key, "report");
  assert.deepEqual(progress(states({ 1: "approved" })), { done: 1, total: 8 });
});
