import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { contrast, parseHex, tokensFrom } from "./contrast";
import { ARTICLE_TYPES, EVIDENCE, NONE, PALETTE, SEQUENTIAL, STUDY_GROUPS, articleTypeOf, describeFilters, evidenceOf, periodOf, studyGroupOf } from "../shared/categories";
import { STUDY_TYPES } from "../shared/stages";
import { templateFor, TEMPLATE_LABEL } from "../stages/templates";

const css = fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf8");
const themes = {
  dark: tokensFrom(css, /^\s*:root,\s*:root\[data-theme="dark"\]\s*$/),
  light: tokensFrom(css, /^\s*:root\[data-theme="light"\]\s*$/),
};

for (const theme of ["light", "dark"] as const) {
  test(`${theme}: CSS category tokens equal categories.ts`, () => {
    PALETTE[theme].forEach((hex, i) => assert.equal(themes[theme][`cat-${i + 1}`]?.toLowerCase(), hex));
    assert.equal(themes[theme]["cat-none"]?.toLowerCase(), NONE[theme]);
    SEQUENTIAL[theme].forEach((hex, i) => assert.equal(themes[theme][`seq-${i + 1}`]?.toLowerCase(), hex));
  });
  test(`${theme}: every category colour has >= 3:1 against the page, card and raised surfaces`, () => {
    const fails: string[] = [];
    for (const bg of ["bg-0", "bg-1", "bg-2"]) {
      for (const hex of [...PALETTE[theme], NONE[theme]]) {
        const r = contrast(parseHex(hex), parseHex(themes[theme][bg]));
        if (r < 3) fails.push(`${hex} on --${bg}: ${r.toFixed(2)}`);
      }
    }
    assert.deepEqual(fails, []);
  });
}

test("study groups mirror the appraisal templates, plus not reported", () => {
  for (const st of STUDY_TYPES) {
    const g = studyGroupOf(st);
    assert.ok(STUDY_GROUPS.some((c) => c.key === g), st);
    if (st === "not_reported") assert.equal(g, "not_reported");
    else {
      const tpl = templateFor(st);
      const map: Record<string, string> = { trial: "trial", cohort: "cohort", cross_sectional: "cross_sectional", qualitative: "qualitative", systematic_review: "review", other: "other" };
      assert.equal(g, map[tpl], `${st} → ${g} vs template ${TEMPLATE_LABEL[tpl]}`);
    }
  }
});

test("every category has a shape and a label, and shapes are unique within a dimension", () => {
  for (const dim of [STUDY_GROUPS, ARTICLE_TYPES, EVIDENCE]) {
    assert.equal(new Set(dim.map((c) => c.shape)).size, dim.length);
    assert.ok(dim.every((c) => c.label));
  }
});

test("article type comes from the stored publication types and never guesses", () => {
  assert.equal(articleTypeOf([]), "unknown");
  assert.equal(articleTypeOf(null), "unknown");
  assert.equal(articleTypeOf(["article"]), "journal_article");
  assert.equal(articleTypeOf(["Journal Article", "Randomized Controlled Trial"]), "journal_article");
  assert.equal(articleTypeOf(["Journal Article", "Systematic Review"]), "review");
  assert.equal(articleTypeOf(["review"]), "review");
  assert.equal(articleTypeOf(["preprint"]), "preprint");
  assert.equal(articleTypeOf(["Editorial"]), "editorial");
  assert.equal(articleTypeOf(["book-chapter"]), "other");
});

test("evidence status, periods and the plain-language filter summary", () => {
  assert.equal(evidenceOf(null), "not_appraised");
  assert.equal(evidenceOf({ textSource: "full_text", unverified: 0 }), "full_text");
  assert.equal(evidenceOf({ textSource: "abstract", unverified: 0 }), "abstract_only");
  assert.equal(evidenceOf({ textSource: "full_text", unverified: 2 }), "unverified");
  assert.equal(periodOf(2024), "2023+");
  assert.equal(periodOf(null), "unknown");
  assert.equal(describeFilters(231, 231, []), "Showing all 231");
  assert.equal(describeFilters(42, 231, [{ dim: "study", keys: ["trial", "cohort"] }, { dim: "period", keys: ["2023+"] }]), "Showing 42 of 231: trial or cohort / case-control; 2023 or later");
});
