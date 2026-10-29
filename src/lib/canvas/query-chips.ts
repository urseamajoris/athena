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
