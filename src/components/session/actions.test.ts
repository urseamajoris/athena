import { test } from "node:test";
import assert from "node:assert/strict";
import { STEP_BY_KEY } from "@/lib/shared/flow";
import type { StageState } from "@/lib/shared/stages";
import { blockerOf, downstreamSteps, frontierStage, stageAction, stepAction, stepNeedsAi, unlockText, upToDateCmd } from "./actions";

/** States for stages 1..n approved, then the given states for the stages after. */
function upTo(n: number, ...rest: StageState[]): Record<string, StageState> {
  const s: Record<string, StageState> = {};
  for (let i = 1; i <= 9; i++) s[String(i)] = i <= n ? "approved" : rest[i - n - 1] ?? "not_started";
  return s;
}

test("the frontier is the first stage that is not confirmed", () => {
  assert.equal(frontierStage({}), 1);
  assert.equal(frontierStage(upTo(3, "needs_review")), 4);
  assert.equal(frontierStage(upTo(9)), null);
});

test("button labels say what happens, with the count where there is one", () => {
  assert.equal(stageAction(3, upTo(2, "needs_review"), { searches: 8 })?.label, "Run 8 searches");
  assert.equal(stageAction(3, upTo(2, "needs_review"), { searches: 1 })?.label, "Run 1 search");
  assert.equal(stageAction(3, upTo(2), {})?.label, "Build my search plan");
  assert.equal(stageAction(4, upTo(3, "needs_review"), { papersFound: 195 })?.label, "Summarise 195 papers");
  assert.equal(stageAction(6, upTo(5, "needs_review"), { papersChosen: 12 })?.label, "Analyse 12 articles");
  assert.equal(stageAction(null, upTo(9))?.label, "Download report");
});

test("every action says what happens next, and whether it uses credits", () => {
  for (let n = 1; n <= 9; n++) {
    const a = stageAction(n, upTo(n - 1, "needs_review"), { searches: 2, idea: "A long enough idea", question: "Q?" });
    assert.ok(a?.next, `stage ${n} has a next line`);
  }
  assert.match(stageAction(3, upTo(2, "needs_review"), { searches: 2 })!.next!, /No credits used/);
  assert.match(stageAction(6, upTo(5, "needs_review"), { papersChosen: 3 })!.next!, /Uses credits/);
});

test("a blocked action says why", () => {
  assert.match(stageAction(1, {}, { idea: "short" })!.disabledReason!, /sentence/);
  assert.equal(stageAction(1, {}, { idea: "Does sleep affect exam grades?" })!.disabledReason, undefined);
  assert.match(stageAction(2, upTo(1, "needs_review"), { question: "" })!.disabledReason!, /question/);
  // Unknown (the server's summary has no question field yet) is not blocked: the server decides.
  assert.equal(stageAction(2, upTo(1, "needs_review"), {})!.disabledReason, undefined);
  assert.match(stageAction(6, upTo(5, "needs_review"), { papersChosen: 0 })!.disabledReason!, /at least one/);
});

test("nothing to press while a stage runs, is out of date or stopped: the banner has those buttons", () => {
  assert.equal(stageAction(4, upTo(3, "running")), null);
  assert.equal(stageAction(7, upTo(6, "stale")), null);
  assert.equal(stageAction(7, upTo(6, "failed")), null);
});

test("a screen offers an action only while it is the one that needs the user", () => {
  const s = upTo(3, "needs_review");
  assert.equal(stepAction("found", s, { papersFound: 20 })?.label, "Summarise 20 papers");
  assert.equal(stepAction("idea", s), null);
  assert.equal(stepAction("choose", s), null);
  // `choose` covers stages 5 and 6.
  assert.equal(stepAction("choose", upTo(5, "needs_review"), { papersChosen: 4 })?.label, "Analyse 4 articles");
  // A finished review: only the report screen has one.
  assert.equal(stepAction("report", upTo(9))?.label, "Download report");
  assert.equal(stepAction("evidence", upTo(9)), null);
});

test("a locked screen names the screen that unlocks it", () => {
  const s = upTo(1, "needs_review");
  assert.equal(blockerOf(STEP_BY_KEY.search, s)?.key, "question");
  assert.equal(unlockText(STEP_BY_KEY.report, s), "Finish Research question first");
  assert.equal(unlockText(STEP_BY_KEY.question, s), null);
  assert.equal(unlockText(STEP_BY_KEY.idea, s), null);
});

test("which screens still need AI", () => {
  const s = upTo(1, "needs_review");
  assert.equal(stepNeedsAi(STEP_BY_KEY.idea, s), false);
  assert.equal(stepNeedsAi(STEP_BY_KEY.question, s), true);
  assert.equal(stepNeedsAi(STEP_BY_KEY.found, s), false);
  assert.equal(stepNeedsAi(STEP_BY_KEY.question, upTo(2)), false);
});

test("bringing a stage up to date re-runs its job, rebuilds the search plan, or keeps for review", () => {
  assert.deepEqual(upToDateCmd(7), { type: "run", stage: 7 });
  assert.deepEqual(upToDateCmd(3), { type: "buildSearch" });
  assert.deepEqual(upToDateCmd(2), { type: "keep", stage: 2 });
});

test("editing an earlier stage puts the later screens that hold work out of date", () => {
  assert.deepEqual(downstreamSteps(2, upTo(4, "needs_review")).map((x) => x.key), ["search", "found", "choose"]);
  assert.deepEqual(downstreamSteps(2, upTo(1, "needs_review")), []);
});
