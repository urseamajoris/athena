import { test } from "node:test";
import assert from "node:assert/strict";
import { dropEmptyGroups, queryBlocks, queryChips } from "./query-chips";

test("empty groups are dropped from a generated query, wherever they sit", () => {
  assert.equal(dropEmptyGroups('("telemedicine" OR "telehealth") AND () AND ("Southeast Asia" OR Thailand)'), '("telemedicine" OR "telehealth") AND ("Southeast Asia" OR Thailand)');
  assert.equal(dropEmptyGroups("() AND (sleep[tiab])"), "(sleep[tiab])");
  assert.equal(dropEmptyGroups("(sleep[tiab]) AND ( )"), "(sleep[tiab])");
  assert.equal(dropEmptyGroups("(sleep[tiab]) AND (())"), "(sleep[tiab])");
  assert.equal(dropEmptyGroups('(a OR b) AND (c) NOT "x"[tiab]'), '(a OR b) AND (c) NOT "x"[tiab]');
  assert.equal(queryBlocks(dropEmptyGroups("(a OR b) AND () AND (c)")).length, 2);
});

test("query chips: terms keep their field tag, parentheses drop, operators stay", () => {
  assert.deepEqual(queryChips('("telemedicine"[mh] OR telehealth*[tiab]) AND ("Southeast Asia" OR Indonesia)'), [
    { type: "term", text: "telemedicine", field: "mh" },
    { type: "op", text: "OR" },
    { type: "term", text: "telehealth*", field: "tiab" },
    { type: "op", text: "AND" },
    { type: "term", text: "Southeast Asia", field: undefined },
    { type: "op", text: "OR" },
    { type: "term", text: "Indonesia", field: undefined },
  ]);
  assert.deepEqual(queryChips("AND ( )"), []);
});

test("query blocks: top-level AND splits concepts; OR terms stay together", () => {
  const b = queryBlocks('(telemedicine[mh] OR "telehealth"[tiab]) AND ("Southeast Asia"[tiab] OR Thailand[tiab])');
  assert.equal(b.length, 2);
  assert.deepEqual(b[0].terms.map((t) => t.text), ["telemedicine", "telehealth"]);
  assert.equal(b[0].terms[0].field, "mh");
  assert.equal(b[1].join, "AND");
  assert.equal(queryBlocks("sleep AND grades NOT children").map((x) => x.join).join(","), ",AND,NOT");
});
