// Turn a Boolean database query into readable chips: terms (with their field tag) and operators.
export type QueryToken = { type: "term"; text: string; field?: string } | { type: "op"; text: "AND" | "OR" | "NOT" };

const TOKEN = /"[^"]*"(?:\[[^\]]+\])?|\(|\)|[^\s()]+/g;

export function queryChips(q: string): QueryToken[] {
  const out: QueryToken[] = [];
  for (const m of q.match(TOKEN) ?? []) {
    if (m === "(" || m === ")") continue;
    const up = m.toUpperCase();
    if (up === "AND" || up === "OR" || up === "NOT") {
      if (out.length && out[out.length - 1].type !== "op") out.push({ type: "op", text: up });
      continue;
    }
    const f = m.match(/^(.*?)(?:\[([^\]]+)\])$/);
    const term = (f ? f[1] : m).replace(/^"|"$/g, "");
    if (term) out.push({ type: "term", text: term, field: f?.[2] });
  }
  while (out.length && out[out.length - 1].type === "op") out.pop();
  return out;
}

/** Plain names for PubMed field tags (shown on the chips, defined once under the query). */
export const FIELD_LABEL: Record<string, string> = {
  tiab: "title/abstract",
  mh: "index term",
  majr: "main index term",
  pt: "publication type",
  tw: "text word",
  ti: "title",
  ab: "abstract",
  la: "language",
  dp: "date",
};

export interface QueryBlock {
  /** How this block joins the previous one ("AND" / "NOT"); null for the first. */
  join: "AND" | "NOT" | null;
  /** Terms inside the block, any of which may match (OR). */
  terms: { text: string; field?: string }[];
}

/**
 * Top-level concept blocks: "(A OR B) AND (C OR D)" → [{A, B}, AND {C, D}]. Terms inside a block are read as
 * alternatives; nested structure inside a block is flattened (the exact string is always shown in the editor).
 */
export function queryBlocks(q: string): QueryBlock[] {
  const tokens = unwrapAndGroups(q.match(TOKEN) ?? []);
  const blocks: QueryBlock[] = [];
  let depth = 0;
  let cur: QueryBlock = { join: null, terms: [] };
  for (const m of tokens) {
    if (m === "(") { depth++; continue; }
    if (m === ")") { depth = Math.max(0, depth - 1); continue; }
    const up = m.toUpperCase();
    if (depth === 0 && (up === "AND" || up === "NOT")) {
      if (cur.terms.length) blocks.push(cur);
      cur = { join: up, terms: [] };
      continue;
    }
    if (up === "AND" || up === "OR" || up === "NOT") continue;
    const f = m.match(/^(.*?)(?:\[([^\]]+)\])$/);
    const text = (f ? f[1] : m).replace(/^"|"$/g, "");
    if (text) cur.terms.push({ text, field: f?.[2]?.toLowerCase() });
  }
  if (cur.terms.length) blocks.push(cur);
  return blocks;
}

/**
 * Remove the brackets around a top-level group that only ANDs other groups, so "((A) AND (B)) AND (C)" reads as
 * three groups, the same as "(A) AND (B) AND (C)", instead of one group whose terms look like alternatives. Only
 * groups with AND (or nothing) before them and AND, NOT or nothing after them, and no OR or NOT inside at their
 * own level, lose their brackets (for any other,
 * removing them could change what the search means).
 */
function unwrapAndGroups(tokens: string[]): string[] {
  let out = tokens;
  for (let changed = true; changed; ) {
    changed = false;
    let depth = 0;
    for (let i = 0; i < out.length && !changed; i++) {
      if (out[i] === ")") depth--;
      if (out[i] !== "(") continue;
      if (depth++ > 0 || (i > 0 && out[i - 1].toUpperCase() !== "AND")) continue;
      // Find the matching ")" and the operators at the group's own level.
      let d = 0, end = -1, and = false, other = false;
      for (let j = i; j < out.length; j++) {
        if (out[j] === "(") d++;
        else if (out[j] === ")" && --d === 0) { end = j; break; }
        else if (d === 1) {
          const up = out[j].toUpperCase();
          if (up === "AND") and = true;
          else if (up === "OR" || up === "NOT") other = true;
        }
      }
      const next = out[end + 1]?.toUpperCase();
      if (end > 0 && and && !other && (next === undefined || next === "AND" || next === "NOT")) {
        out = [...out.slice(0, i), ...out.slice(i + 1, end), ...out.slice(end + 1)];
        changed = true;
      }
    }
  }
  return out;
}

/** Remove empty groups ("AND ()"), which a topic with no synonyms can produce and which no database accepts. */
export { dropEmptyGroups } from "../sources/syntax";
