import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { toXaiSchema } from "./ai/schema";
import { normalizeDoi, normalizeTitle } from "./util";
import { citationScore, recencyScore, weightedTotal } from "./scoring";
import { surname, scrubIds } from "./shared/stages";

test("xAI schema strips unsupported keywords but keeps structure", () => {
  const s = toXaiSchema(z.object({ a: z.string().min(2).max(5), b: z.array(z.number()).min(1).max(3), c: z.enum(["x", "y"]).nullable() }));
  const txt = JSON.stringify(s);
  for (const k of ["minLength", "maxLength", "minItems", "maxItems", "pattern", "allOf", "$schema"]) assert.ok(!txt.includes(k), k);
  assert.deepEqual((s as { required: string[] }).required, ["a", "b", "c"]);
  assert.equal((s as { additionalProperties: boolean }).additionalProperties, false);
});
test("DOI normalisation", () => {
  assert.equal(normalizeDoi("https://doi.org/10.1000/ABC"), "10.1000/abc");
  assert.equal(normalizeDoi("doi: 10.1/x"), "10.1/x");
  assert.equal(normalizeDoi("not a doi"), null);
});
test("title normalisation for dedup", () => {
  assert.equal(normalizeTitle("Télémedicine in <i>Viet Nam</i>: a review."), normalizeTitle("Telemedicine in Viet Nam - A Review"));
});
test("recency and citation formulas", () => {
  assert.equal(recencyScore(2026, 2026).score, 5);
  assert.equal(recencyScore(2010, 2026).score, 0);
  assert.equal(recencyScore(null).score, 0);
  assert.equal(citationScore(100, 2024, 2026).score, 5); // 33.3/yr
  assert.equal(citationScore(10, 2024, 2026).score, 2); // 3.3/yr
});
test("weighted total is 100 for all-5 scores", () => {
  assert.equal(weightedTotal({ topicFit: 5, designStrength: 5, settingMatch: 5, recency: 5, citationImpact: 5 }), 100);
});
test("surname handles PubMed and OpenAlex name styles", () => {
  assert.equal(surname("Lee SWH"), "Lee");
  assert.equal(surname("Carl Froilan D. Leochico"), "Leochico");
});
test("scrubIds removes leaked internal IDs from prose", () => {
  assert.equal(scrubIds("Readiness is unknown (sy_5aec975cf8e44421, c_c4565292078b4aaf). Matters for SEA."), "Readiness is unknown. Matters for SEA.");
  assert.equal(scrubIds("Gaps in CMLV (c_43357be79dca409c; c_f7029f41f33d4230), and more"), "Gaps in CMLV, and more");
  assert.equal(scrubIds("No ids here."), "No ids here.");
});
import { repairId } from "./grounding";
test("repairId fixes only unambiguous formatting slips", () => {
  const allowed = ["c_6fb22aabb004ae4c", "c_1111222233334444"];
  assert.equal(repairId("c6fb22aabb004ae4c", allowed), "c_6fb22aabb004ae4c");
  assert.equal(repairId("6fb22aabb004ae4c", allowed), "c_6fb22aabb004ae4c");
  assert.equal(repairId(" [c_6fb22aabb004ae4c] ", allowed), "c_6fb22aabb004ae4c");
  assert.equal(repairId("c_deadbeefdeadbeef", allowed), "c_deadbeefdeadbeef"); // unknown stays unknown → rejected later
  assert.equal(repairId("c_6fb22aab", allowed), "c_6fb22aab"); // truncated: not repaired
});

import { hardFilterPubmed, openalexTypes } from "./sources/filters";
test("hard retrieval filter: off by default, explicit when set", () => {
  assert.equal(hardFilterPubmed(undefined), null);
  assert.equal(hardFilterPubmed(["journal_article", "review", "preprint"]), null);
  assert.match(hardFilterPubmed(["review"])!, /review\[pt\]/);
  assert.match(hardFilterPubmed(["journal_article"])!, /NOT/);
  assert.equal(openalexTypes(undefined), "article|review|preprint");
  assert.equal(openalexTypes(["review"]), "review");
  assert.equal(openalexTypes(["journal_article", "preprint"]), "article|preprint");
});
