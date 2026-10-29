import { test } from "node:test";
import assert from "node:assert/strict";
import { dropEmptyGroups, withBlock } from "./syntax";

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

// Review of run 3: a block counted as already in the query when one of its words was inside another word.
const US = '("United States"[mh] OR USA[tiab] OR "United States"[tiab])';
const USABILITY = '("diabetes" OR "blood glucose" OR "glycemic control") AND ("mobile app" OR "mobile apps" OR mhealth OR "smartphone app") AND (usability OR "user interface" OR "blood glucose tracking")';
test("a setting block's words count only as whole words or phrases in the query", () => {
  assert.deepEqual(withBlock(USABILITY, US), { query: `${USABILITY} AND ${US}`, added: true });
  assert.equal(withBlock('(diabetes[tiab]) AND ("pregnant woman"[tiab] OR women[tiab])', "(Oman[mh] OR Oman[tiab] OR Omani[tiab])").added, true);
  assert.equal(withBlock('(diabetes[tiab]) AND ("American Indian"[tiab])', "(India[mh] OR India[tiab])").added, true);
  // Field tags, quotes, phrases with commas and truncation do not hide a word the query does use.
  assert.equal(withBlock('(diabetes[tiab]) AND (Thai*[tiab])', "(Thailand[mh] OR Thai[tiab])").added, false);
  assert.equal(withBlock('(diabetes[tiab]) AND ("Asia, Southeastern"[mh])', '("Asia, Southeastern"[mh] OR Thailand[tiab])').added, false);
  assert.equal(withBlock('(diabetes[tiab]) AND ("United States"[tiab])', US).added, false);
});

test("a block of AND-ed groups adds each group the query lacks", () => {
  const block = "(India[mh] OR India[tiab]) AND (rural[tiab] OR village*[tiab])";
  assert.deepEqual(withBlock("(diabetes[tiab]) AND (rural[tiab])", block), { query: "(diabetes[tiab]) AND (rural[tiab]) AND (India[mh] OR India[tiab])", added: true });
  assert.deepEqual(withBlock("(diabetes[tiab]) AND (villages[tiab])", block), { query: "(diabetes[tiab]) AND (villages[tiab]) AND (India[mh] OR India[tiab])", added: true });
  assert.equal(withBlock("(diabetes[tiab]) AND (India[tiab]) AND (rural[tiab])", block).added, false);
  assert.equal(withBlock("(diabetes[tiab])", block).query, `(diabetes[tiab]) AND (India[mh] OR India[tiab]) AND (rural[tiab] OR village*[tiab])`);
  // A top-level OR is one block, added whole.
  assert.equal(withBlock("(diabetes[tiab])", "(India[tiab]) OR (rural[tiab])").query, "(diabetes[tiab]) AND ((India[tiab]) OR (rural[tiab]))");
});
