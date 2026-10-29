import { test } from "node:test";
import assert from "node:assert/strict";
import { scopingOrderProblem, type ScopingTurn } from "./ai-schemas";

const cov = (c: Partial<ScopingTurn["coverage"]>): ScopingTurn["coverage"] => ({ population: null, setting: null, phenomenon: null, outcome: null, timeframe: null, studyTypes: null, ...c });
const turn = (questionTarget: ScopingTurn["questionTarget"], coverage: ScopingTurn["coverage"], done = false) => ({ done, questionTarget, coverage });

// Coverage as the model returned it in QA run 3 (prj_cea02fb2d9c94d97): the idea named who, where, what and the outcome.
const run3 = cov({ population: "diabetes patients in Thailand", setting: "Thailand", phenomenon: "mobile apps for diabetes", outcome: "blood sugar control" });

test("scoping: the first question is about what the person studies, not publication years", () => {
  // Run 3's real first turn: "Which publication years should we focus on?"
  assert.match(scopingOrderProblem(turn("timeframe", run3), 0) ?? "", /first question.*population, phenomenon or outcome/);
  assert.match(scopingOrderProblem(turn("studyTypes", run3), 0) ?? "", /first question/);
  // Sharpening one of the core fields first is the intended opening.
  assert.equal(scopingOrderProblem(turn("population", run3), 0), null);
  assert.equal(scopingOrderProblem(turn("outcome", run3), 0), null);
  // Run 2's real first turn asked about the setting with the core fields known: allowed.
  assert.equal(scopingOrderProblem(turn("setting", cov({ population: "healthcare workers", phenomenon: "long COVID", outcome: "return-to-work outcomes" })), 0), null);
});

test("scoping: years and study designs wait until population, phenomenon and outcome are known", () => {
  assert.match(scopingOrderProblem(turn("timeframe", cov({ population: "university students" })), 2) ?? "", /phenomenon, outcome before timeframe/);
  // Run 1's real fifth turn (years, after who, what and outcome were answered): allowed.
  assert.equal(scopingOrderProblem(turn("timeframe", cov({ population: "university students (first years)", setting: "any country", phenomenon: "sleep duration", outcome: "exam grades" })), 4), null);
  // Run 3's second turn (study designs, once all core fields were covered): allowed.
  assert.equal(scopingOrderProblem(turn("studyTypes", { ...run3, timeframe: "last 5 years" }), 1), null);
  // Finishing is never blocked.
  assert.equal(scopingOrderProblem(turn(null, cov({}), true), 0), null);
});
