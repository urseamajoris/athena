import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, frontierNodeId, type GraphInput } from "./graph";
import { taskFor } from "./tasks";
import { finished, input as emptyInput, states, summary } from "./fixtures";

test("every node has a plain task headline, never a bare stage name", () => {
  const input: GraphInput = finished();
  const g = buildGraph(input);
  for (const n of g.nodes) {
    const t = taskFor(n, input);
    assert.ok(t.headline.length > 8, n.id);
    assert.ok(!/^Stage \d/.test(t.headline), n.id);
    assert.ok(t.help.length > 20, n.id);
  }
});

test("the empty idea asks for the idea; the step number is shown", () => {
  const input: GraphInput = emptyInput({ summary: null });
  const idea = buildGraph(input).nodes.find((n) => n.id === "idea")!;
  const t = taskFor(idea, input);
  assert.equal(t.headline, "Tell us what you want to research");
  assert.equal(t.step, 1);
});

test("'Go to step 3' before any search exists opens the first topic, and its panel says step 3", () => {
  const topics = summary().topics.map((t) => ({ ...t, approved: true }));
  const input: GraphInput = emptyInput({ states: states(2), summary: summary({ topics }) });
  const g = buildGraph(input);
  const target = g.nodes.find((n) => n.id === frontierNodeId(g, input.states))!;
  assert.equal(target.id, "topic:t1");
  const t = taskFor(target, input);
  assert.equal(t.step, 3);
  assert.equal(t.headline, "Turn the topics into database searches");
  // Any other topic is still the step-2 topic editor.
  assert.equal(taskFor(g.nodes.find((n) => n.id === "topic:t2")!, input).step, 2);
});
