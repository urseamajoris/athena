import { test } from "node:test";
import assert from "node:assert/strict";
import { dropEmptyGroups } from "./syntax";

test("empty groups and their operators are removed from a query", () => {
  assert.equal(dropEmptyGroups('("telemedicine" OR "telehealth") AND () AND ("Southeast Asia" OR Thailand)'), '("telemedicine" OR "telehealth") AND ("Southeast Asia" OR Thailand)');
  assert.equal(dropEmptyGroups('() AND ("a")'), '("a")');
  assert.equal(dropEmptyGroups('("a") AND ( )'), '("a")');
  assert.equal(dropEmptyGroups('("a") NOT ()'), '("a")');
  assert.equal(dropEmptyGroups('("a" OR ()) AND (() OR ())'), '("a")');
});

test("a query without empty groups is left exactly as it was", () => {
  const q = '(telemedicine[mh] OR "telehealth"[tiab]) AND ("Asia, Southeastern"[mh] OR Thailand[tiab])';
  assert.equal(dropEmptyGroups(q), q);
});
