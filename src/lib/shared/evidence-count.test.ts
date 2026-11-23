import { test } from "node:test";
import assert from "node:assert/strict";
import { paperCount, paperCountLabel } from "./evidence-count";

const claims = { c1: { paperId: "p1" }, c2: { paperId: "p1" }, c3: { paperId: "p2" }, c4: { paperId: "p3" } };

test("paperCount counts distinct papers, not quotes", () => {
  assert.equal(paperCount(["c1", "c2"], claims), 1);
  assert.equal(paperCount(["c1", "c2", "c3", "c4"], claims), 3);
  assert.equal(paperCount(["c1", "missing"], claims), 1);
  assert.equal(paperCount([], claims), 0);
});

test("a single-paper known statement is labelled as one study", () => {
  assert.equal(paperCountLabel(1, "known")?.text, "1 paper only");
  assert.match(paperCountLabel(1, "known")!.title, /not agreement/);
  assert.equal(paperCountLabel(1, "unknown")?.text, "1 paper");
  assert.equal(paperCountLabel(3, "known")?.text, "3 papers");
  assert.equal(paperCountLabel(0, "known"), null);
});
