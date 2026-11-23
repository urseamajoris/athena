// Boolean query hygiene shared by both databases. Pure (unit-tested).

const HOLE = "\u0000";

/**
 * Remove empty groups such as "()" together with the operator that joins them, so
 * `("a" OR "b") AND () AND ("c")` becomes `("a" OR "b") AND ("c")`. Groups that only held
 * empty groups are removed too. A model (or a topic with no synonyms) can produce them, and
 * PubMed and OpenAlex either reject them or silently return nonsense.
 */
export function dropEmptyGroups(query: string): string {
  let q = query;
  for (let prev = ""; prev !== q; ) {
    prev = q;
    q = q
      .replace(/\(\s*\)/g, HOLE)
      .replace(new RegExp(`\\s*\\b(?:AND|OR|NOT)\\s*${HOLE}`, "g"), "")
      .replace(new RegExp(`${HOLE}\\s*(?:AND|OR|NOT)\\b\\s*`, "g"), "")
      .replace(new RegExp(HOLE, "g"), "");
  }
  return q.replace(/\s{2,}/g, " ").trim();
}
