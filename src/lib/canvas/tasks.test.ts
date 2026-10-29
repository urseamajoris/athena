import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, type GraphInput } from "./graph";
import { taskFor } from "./tasks";
import { finished, input as emptyInput } from "./fixtures";

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
