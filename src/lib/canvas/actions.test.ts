import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph } from "./graph";
import { cascadeStep, childOptions, nextAction, siblingOptions, stageAction } from "./actions";
import { QUERIES, finished, input, states, summary } from "./fixtures";

const node = (g: ReturnType<typeof buildGraph>, id: string) => g.nodes.find((n) => n.id === id)!;

test("exactly one node has a next action: the frontier", () => {
  const inp = input({ states: states(2), summary: summary({ queries: QUERIES }) });
  const g = buildGraph(inp);
  const withAction = g.nodes.filter((n) => nextAction(n, g, inp));
  assert.deepEqual(withAction.map((n) => n.id), ["query:t1"]);
  assert.equal(nextAction(withAction[0], g, inp)!.label, "Run the searches");
});

test("ghost topics offer Accept; the Idea offers to accept them all before approval", () => {
  const inp = input({ states: states(1) });
  const g = buildGraph(inp);
  assert.deepEqual(nextAction(node(g, "topic:t1"), g, inp)!.cmd, { type: "acceptTopic", topicId: "t1" });
  const a = nextAction(node(g, "idea"), g, inp)!;
  assert.equal(a.label, "Keep 2 suggested topics");
  const accepted = input({ states: states(1), client: { acceptedTopics: ["t1", "t2"], pinnedQuotes: [] } });
  assert.equal(nextAction(node(buildGraph(accepted), "idea"), buildGraph(accepted), accepted)!.label, "Use these topics");
});

test("the Idea's action follows the scoping conversation", () => {
  const label = (over: Parameters<typeof summary>[0], st = states(1)) => stageAction(2, input({ states: st, summary: summary(over) }))!.label;
  assert.equal(label({ topics: [], scoping: { messages: 0, asked: 0, maxQuestions: 5, done: false, awaitingAnswer: false } }), "Sharpen my idea");
  assert.equal(label({ topics: [], scoping: { messages: 2, asked: 1, maxQuestions: 5, done: false, awaitingAnswer: true } }), "Answer the scoping question");
  assert.equal(label({ topics: [] }), "Suggest search topics");
  assert.equal(stageAction(1, input({ idea: "short" }))!.disabledReason, "Write at least a sentence about your idea");
});

test("each stage's next action", () => {
  const at = (n: number, extra = {}) => stageAction(n + 1, finished({ states: states(n), ...extra }))!.label;
  assert.equal(at(3), "Summarise the papers");
  assert.equal(at(4), "Rank the papers");
  assert.equal(at(5), "Appraise selected papers");
  assert.equal(at(6), "Summarise the evidence");
  assert.equal(at(7), "Suggest research questions");
  assert.equal(at(8), "Finish and export");
  assert.equal(stageAction(null, finished())!.label, "Download report");
  assert.equal(stageAction(3, input({ states: states(2) }))!.label, "Write the searches");
});

test("running stages have no button; failed job stages offer a retry", () => {
  assert.equal(stageAction(5, finished({ states: states(4, { 5: "running" }) })), null);
  assert.equal(stageAction(5, finished({ states: states(4, { 5: "failed" }) }))!.label, "Retry summary table");
  assert.deepEqual(stageAction(5, finished({ states: states(4, { 5: "failed" }) }))!.cmd, { type: "run", stage: 5 });
});

test("Export is locked until a research question is chosen, and says why", () => {
  const inp = finished({ states: states(8) });
  inp.summary = { ...inp.summary!, questions: { count: 3, chosenId: null, chosenText: null } };
  assert.equal(stageAction(9, inp)!.disabledReason, "Choose one research question first");
});

test("a stale frontier offers the single Re-run downstream action", () => {
  const inp = finished({ states: states(2, { 3: "stale", 4: "stale", 5: "stale" }) });
  const g = buildGraph(inp);
  assert.equal(nextAction(node(g, "query:t1"), g, inp)!.label, "Bring later steps up to date");
  assert.equal(nextAction(node(g, "corpus"), g, inp), null, "later stale nodes do not repeat it");
});

test("stage gating: a child type is offered only once its parent's work is ready", () => {
  const early = input({ states: states(0) });
  const g0 = buildGraph(early);
  assert.equal(childOptions(node(g0, "idea"), g0, early)[0].reason, "Start scoping first");

  const scoped = input({ states: states(2), summary: summary({ queries: QUERIES }) });
  const g1 = buildGraph(scoped);
  const fromQuery = childOptions(node(g1, "query:t1"), g1, scoped)[0];
  assert.equal(fromQuery.kind, "corpus");
  assert.equal(fromQuery.reason, undefined, "queries are built and in review, so the corpus can be created");
  assert.deepEqual(fromQuery.cmd, { type: "approve", stage: 3 });

  const running = finished({ states: states(3, { 4: "running" }) });
  const g2 = buildGraph(running);
  assert.equal(childOptions(node(g2, "corpus"), g2, running)[0].reason, "Wait for this step to finish");

  const stale = finished({ states: states(3, { 4: "stale" }) });
  const g3 = buildGraph(stale);
  assert.equal(childOptions(node(g3, "corpus"), g3, stale)[0].reason, "Re-run or keep the stale results first");

  const failed = finished({ states: states(3, { 4: "failed" }) });
  const g4 = buildGraph(failed);
  assert.equal(childOptions(node(g4, "corpus"), g4, failed)[0].reason, "This step failed; retry it first");
});

test("existing children are opened rather than created twice", () => {
  const inp = finished();
  const g = buildGraph(inp);
  assert.deepEqual(childOptions(node(g, "corpus"), g, inp)[0].cmd, { type: "open", nodeId: "table" });
  assert.deepEqual(childOptions(node(g, "export"), g, inp), []);
});

test("only topics have siblings, and only while there is room for one", () => {
  const inp = input({ states: states(2) });
  const g = buildGraph(inp);
  assert.equal(siblingOptions(node(g, "topic:t1"), g, inp).length, 1);
  assert.deepEqual(siblingOptions(node(g, "idea"), g, inp), []);
  const full = input({ states: states(2), summary: summary({ topics: Array.from({ length: 8 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, origin: "user", approved: true, synonyms: 0, controlledTerms: 0 })) }) });
  const gf = buildGraph(full);
  assert.equal(siblingOptions(node(gf, "topic:t0"), gf, full)[0].reason, "A review can have at most 8 topics");
});

test("Re-run downstream cascade: re-run job stages, re-open others, wait at each checkpoint", () => {
  assert.deepEqual(cascadeStep(states(9)), { kind: "done" });
  assert.deepEqual(cascadeStep(states(1, { 2: "needs_review", 3: "stale", 4: "stale" })), { kind: "wait", stage: 2 });
  assert.deepEqual(cascadeStep(states(2, { 3: "stale", 4: "stale" })), { kind: "keep", stage: 3 }, "search has no job: re-open for review");
  assert.deepEqual(cascadeStep(states(3, { 4: "stale", 5: "stale" })), { kind: "run", stage: 4 });
  assert.deepEqual(cascadeStep(states(3, { 4: "running", 5: "stale" })), { kind: "wait", stage: 4 });
  assert.deepEqual(cascadeStep(states(4, { 5: "needs_review", 6: "stale" })), { kind: "wait", stage: 5 });
});
