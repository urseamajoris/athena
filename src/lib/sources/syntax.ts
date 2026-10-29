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

/** The search words in a block, lower-cased and without field tags or truncation: `(Thailand[mh] OR "Thai people")` → ["thailand", "thai people"]. */
export function blockTerms(block: string): string[] {
  const tokens = block.match(/"[^"]*"(?:\[[^\]]*\])?|[^\s()]+/g) ?? [];
  return [...new Set(tokens.filter((t) => !/^(?:AND|OR|NOT)$/i.test(t)).map((t) => t.replace(/\[[^\]]*\]$/, "").replace(/^"|"$/g, "").replace(/\*$/, "").trim().toLowerCase()).filter((t) => t.length >= 3))];
}

/** Whether `s` is one group in parentheses from its first character to its last: "(a OR b)", not "(a) OR (b)". */
function oneGroup(s: string): boolean {
  if (!s.startsWith("(") || !s.endsWith(")")) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0 && i < s.length - 1) return false;
  }
  return depth === 0;
}

/**
 * `query AND (block)`, unless the query already uses one of the block's words. Keeps a review limited to its
 * setting (a country, a region, a care setting) in every search, whatever the AI wrote for each topic.
 */
export function withBlock(query: string, block: string): { query: string; added: boolean } {
  const b = block.trim();
  const terms = blockTerms(b);
  const q = query.toLowerCase();
  if (!terms.length || terms.some((t) => q.includes(t))) return { query, added: false };
  return { query: `${query.trim()} AND ${oneGroup(b) ? b : `(${b})`}`, added: true };
}
