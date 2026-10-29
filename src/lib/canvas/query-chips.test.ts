import { test } from "node:test";
import assert from "node:assert/strict";
import { dropEmptyGroups, queryBlocks } from "./query-chips";

test("empty groups are dropped from a generated query, wherever they sit", () => {
  assert.equal(dropEmptyGroups('("telemedicine" OR "telehealth") AND () AND ("Southeast Asia" OR Thailand)'), '("telemedicine" OR "telehealth") AND ("Southeast Asia" OR Thailand)');
  assert.equal(dropEmptyGroups("() AND (sleep[tiab])"), "(sleep[tiab])");
  assert.equal(dropEmptyGroups("(sleep[tiab]) AND ( )"), "(sleep[tiab])");
  assert.equal(dropEmptyGroups("(sleep[tiab]) AND (())"), "(sleep[tiab])");
  assert.equal(dropEmptyGroups('(a OR b) AND (c) NOT "x"[tiab]'), '(a OR b) AND (c) NOT "x"[tiab]');
  assert.equal(queryBlocks(dropEmptyGroups("(a OR b) AND () AND (c)")).length, 2);
});
