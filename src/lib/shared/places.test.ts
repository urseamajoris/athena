import { test } from "node:test";
import assert from "node:assert/strict";
import { placeTerms, placesIn } from "./places";

const same = (a: string, b: string) => [...placesIn(a)].some((x) => placesIn(b).has(x));

test("countries by any of their names, as whole words", () => {
  assert.equal(same("United States", "USA"), true);
  assert.equal(same("United States", "Long COVID among U. S. healthcare workers"), true);
  assert.equal(same("American adults", "a Multicenter Cohort Analysis of US Healthcare Personnel"), true);
  assert.equal(same("UK", "England and Wales"), true);
  assert.equal(same("United Kingdom", "British adults"), true);
  assert.equal(same("United States", "United Kingdom"), false);
  assert.equal(same("Thailand", "Thai adults"), true);
  assert.deepEqual(placeTerms("rural Thailand"), ["thailand", "thai"]);
});

test("words inside other words, languages, regions and pronouns are not countries", () => {
  for (const s of ["rural Indiana", "usability of a diabetes app", "Apps and the Woman With Gestational Diabetes", "Latin American adults", "South American cohorts", "Give Us a Voice!"]) assert.equal(placesIn(s).size, 0, s);
  // "Spanish-speaking" is a language; "Spanish hospitals" are in Spain.
  assert.deepEqual([...placesIn("Spanish-speaking Hispanic adults with type 2 diabetes in the US")], [...placesIn("USA")]);
  assert.equal(same("Spain", "a cross-sectional survey in two Spanish hospitals"), true);
  // "American Indian" adults are in the USA, not India.
  assert.equal(same("India", "American Indian adults"), false);
  assert.equal(same("USA", "American Indian adults"), true);
});
