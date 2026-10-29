import { test } from "node:test";
import assert from "node:assert/strict";
import type { StateStorage } from "zustand/middleware";
import { buildGraph } from "./graph";
import { NODE_W, layeredLayout, withPinned } from "./layout";
import { createCanvasStore, sessionOf } from "./store";
import { finished } from "./fixtures";

function memoryStorage(): StateStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

test("layered layout: one column per stage, left to right, no overlaps", () => {
  const g = buildGraph(finished());
  const pos = layeredLayout(g.nodes);
  assert.ok(pos.idea.x < pos["topic:t1"].x && pos["topic:t1"].x < pos["query:t1"].x && pos["query:t1"].x < pos.corpus.x && pos.corpus.x < pos.export.x);
  assert.equal(pos["topic:t1"].x, pos["topic:t2"].x);
  assert.notEqual(pos["topic:t1"].y, pos["topic:t2"].y);
  const boxes = Object.values(pos);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(Math.abs(a.x - b.x) >= NODE_W || Math.abs(a.y - b.y) >= 100, "nodes overlap");
  }
});

test("300 pinned quotes pack into a grid below the pipeline instead of one tall column", () => {
  const claims = Array.from({ length: 290 }, (_, i) => ({ id: `c${i}`, appraisalId: "a1", paperId: "p", paperTitle: "P", field: "aim", statement: "s", quote: `q${i}`, verified: i % 7 !== 0, userAccepted: false, userRejected: false }));
  const g = buildGraph(finished({ claims, client: { acceptedTopics: [], pinnedQuotes: claims.map((c) => c.id) } }));
  assert.equal(g.nodes.length, 301);
  const pos = layeredLayout(g.nodes);
  const quoteYs = g.nodes.filter((n) => n.kind === "quote").map((n) => pos[n.id].y);
  const mainBottom = Math.max(...g.nodes.filter((n) => n.kind !== "quote").map((n) => pos[n.id].y));
  assert.ok(Math.min(...quoteYs) > mainBottom, "quotes sit below the main pipeline");
  const rows = new Set(quoteYs).size;
  assert.ok(rows <= 30, `${rows} rows is too tall`);
});

test("auto-layout never moves a node the user placed by hand", () => {
  const g = buildGraph(finished());
  const auto = layeredLayout(g.nodes);
  const merged = withPinned(auto, { corpus: { x: 999, y: -42 }, "node:that-no-longer-exists": { x: 1, y: 1 } });
  assert.deepEqual(merged.corpus, { x: 999, y: -42 });
  assert.deepEqual(merged.idea, auto.idea);
  assert.equal("node:that-no-longer-exists" in merged, false);
});

test("store: hand-placed positions and choices are saved per session and survive a reload", async () => {
  const storage = memoryStorage();
  const a = createCanvasStore(storage);
  a.getState().pinPosition("prj_1", "corpus", { x: 10.4, y: 20.6 });
  a.getState().acceptTopics("prj_1", ["t1", "t1", "t2"]);
  a.getState().pinQuotes("prj_1", ["c1"]);
  a.getState().setView("prj_2", "list");
  a.getState().openPanel("corpus");

  assert.deepEqual(sessionOf(a.getState(), "prj_1").pinned.corpus, { x: 10, y: 21 });
  assert.deepEqual(sessionOf(a.getState(), "prj_1").acceptedTopics, ["t1", "t2"], "no duplicates");
  assert.equal(sessionOf(a.getState(), "prj_1").view, null, "sessions are independent");
  assert.equal(sessionOf(a.getState(), "prj_2").view, "list");

  const b = createCanvasStore(storage);
  await b.persist.rehydrate();
  assert.deepEqual(sessionOf(b.getState(), "prj_1").pinned.corpus, { x: 10, y: 21 });
  assert.deepEqual(sessionOf(b.getState(), "prj_1").pinnedQuotes, ["c1"]);
  assert.equal(b.getState().panel, null, "the open panel is not persisted");
  assert.ok(!storage.data.get("athena-canvas")!.includes("\"panel\""));
});

test("store: unpin, reset layout, reviewed papers, cascade flag", () => {
  const s = createCanvasStore(memoryStorage());
  const st = () => sessionOf(s.getState(), "p");
  s.getState().pinPosition("p", "a", { x: 1, y: 1 });
  s.getState().pinPosition("p", "b", { x: 2, y: 2 });
  s.getState().unpinPosition("p", "a");
  assert.deepEqual(Object.keys(st().pinned), ["b"]);
  s.getState().resetLayout("p");
  assert.deepEqual(st().pinned, {});
  s.getState().markReviewed("p", "ap1");
  s.getState().markReviewed("p", "ap1");
  assert.deepEqual(st().reviewed, ["ap1"]);
  s.getState().setCascade("p", true);
  assert.equal(st().cascade, true);
  s.getState().unpinQuote("p", "nope");
  s.getState().toggleMinimap("p");
  assert.equal(st().minimap, true);
});
