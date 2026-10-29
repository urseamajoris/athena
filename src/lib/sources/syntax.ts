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

/** A block's search terms, lower-cased and without field tags; `prefix` when the term was truncated ("diabet*"). */
function terms(block: string): { text: string; prefix: boolean }[] {
  const tokens = block.match(/"[^"]*"(?:\[[^\]]*\])?|[^\s()]+/g) ?? [];
  return tokens
    .filter((t) => !/^(?:AND|OR|NOT)$/i.test(t))
    .map((t) => t.replace(/\[[^\]]*\]$/, "").replace(/^"|"$/g, "").trim())
    .map((t) => ({ text: t.replace(/\*$/, "").toLowerCase(), prefix: t.endsWith("*") }))
    .filter((t) => t.text.length >= 2);
}

/** The search words in a block, lower-cased and without field tags or truncation: `(Thailand[mh] OR "Thai people")` → ["thailand", "thai people"]. */
export function blockTerms(block: string): string[] {
  return [...new Set(terms(block).map((t) => t.text))];
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

/** A block's groups joined by AND at its top level: "(India[mh]) AND (rural[tiab])" → ["(India[mh])", "(rural[tiab])"]. */
function andGroups(block: string): string[] {
  let s = block.trim();
  while (oneGroup(s)) s = s.slice(1, -1).trim();
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') quoted = !quoted;
    else if (quoted) continue;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && /\s/.test(c)) {
      const op = /^\s+(AND|OR|NOT)\s+/.exec(s.slice(i));
      if (!op) continue;
      if (op[1] !== "AND") return [block.trim()]; // OR or NOT at the top level: one block, as written
      parts.push(s.slice(start, i).trim());
      start = i + op[0].length;
      i = start - 1;
    }
  }
  parts.push(s.slice(start).trim());
  return parts.length > 1 ? parts : [block.trim()];
}

/** The words of a text, lower-case, one space apart and padded with spaces, without field tags or truncation marks. */
const spaced = (s: string) => ` ${s.replace(/\[[^\]]*\]/g, " ").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean).join(" ")} `;

/**
 * `query AND (block)`, unless the query already uses the block's words. Keeps a review limited to its setting (a
 * country, a region, a care setting) in every search, whatever the AI wrote for each topic. Words count only as
 * whole words or phrases ("usability" does not use "USA", "woman" does not use "Oman"), and a block of several
 * AND-ed groups ("(India) AND (rural)") adds each group the query lacks, so a query that says "rural" still gets India.
 */
export function withBlock(query: string, block: string): { query: string; added: boolean } {
  const b = block.trim();
  const q = spaced(query);
  const uses = (t: { text: string; prefix: boolean }) => {
    const w = spaced(t.text).trimEnd();
    return w.trim() !== "" && (t.prefix ? q.includes(w) : q.includes(`${w} `));
  };
  const groups = andGroups(b);
  const missing = groups.filter((g) => terms(g).length && !terms(g).some(uses));
  if (!missing.length) return { query, added: false };
  return { query: `${query.trim()} AND ${missing.map((g) => (oneGroup(g) ? g : `(${g})`)).join(" AND ")}`, added: true };
}

/** A setting block built from plain words, with a field tag where the database has one: `(thailand[tiab] OR thai[tiab])`. */
export function termsBlock(words: string[], field = ""): string {
  return words.length ? `(${words.map((w) => `${/\s/.test(w) ? `"${w}"` : w}${field}`).join(" OR ")})` : "";
}
