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
  const tokens = q.match(TOKEN) ?? [];
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

/** Remove empty groups ("AND ()"), which a topic with no synonyms can produce and which no database accepts. */
export { dropEmptyGroups } from "../sources/syntax";
