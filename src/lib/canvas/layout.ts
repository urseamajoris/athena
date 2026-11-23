// Tidy left→right layout. A synchronous layered layout renders immediately; elkjs (lazy-loaded)
// refines it. Quotes pack into a grid under their parent. Nodes the user placed by hand never move.
import { KIND_COLUMN, type GEdge, type GNode, type NodeKind } from "./graph";

export const NODE_W = 286;
export const NODE_H = 196;
export const QUOTE_H = 116;
const COL_GAP = 84;
const ROW_GAP = 24;

export function nodeHeight(kind: NodeKind): number {
  switch (kind) {
    case "quote": return QUOTE_H;
    case "ai_config": return 244;
    case "topic_corpus": return 236;
    case "query_corpus": return 226;
    case "paper_group": return 244;
    case "query_item": return 172;
    default: return NODE_H;
  }
}

export type Pos = { x: number; y: number };
export type Positions = Record<string, Pos>;

/** Column-per-stage layout with dense column compaction (empty columns take 0 width). Deterministic. */
export function layeredLayout(nodes: GNode[]): Positions {
  const out: Positions = {};
  const main = nodes.filter((n) => n.kind !== "quote");
  const cols = new Map<number, GNode[]>();
  for (const n of main) {
    const c = KIND_COLUMN[n.kind];
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c)!.push(n);
  }
  const sortedCols = [...cols.keys()].sort((a, b) => a - b);
  sortedCols.forEach((c, colIdx) => {
    const list = cols.get(c)!;
    const totalH = list.reduce((acc, n) => acc + nodeHeight(n.kind), 0) + Math.max(0, list.length - 1) * ROW_GAP;
    let y = -totalH / 2;
    for (const n of list) {
      out[n.id] = { x: colIdx * (NODE_W + COL_GAP), y };
      y += nodeHeight(n.kind) + ROW_GAP;
    }
  });
  packQuotes(nodes, out);
  return out;
}

/** Quote nodes go in a grid below their parent, roughly square, so 300 nodes stay navigable. */
export function packQuotes(nodes: GNode[], out: Positions) {
  const quotes = nodes.filter((n) => n.kind === "quote");
  if (!quotes.length) return;
  const byParent = new Map<string, GNode[]>();
  for (const q of quotes) {
    const p = q.parents[0];
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p)!.push(q);
  }
  const kindById = new Map(nodes.map((n) => [n.id, n.kind]));
  const mainBottom = Math.max(
    0,
    ...Object.entries(out)
      .filter(([id]) => !id.startsWith("quote:"))
      .map(([id, p]) => p.y + nodeHeight(kindById.get(id) ?? "idea")),
  );
  let top = mainBottom + 96;
  for (const [parent, list] of byParent) {
    const origin = out[parent] ?? { x: 0, y: 0 };
    const perRow = Math.min(12, Math.max(3, Math.ceil(Math.sqrt(list.length * 1.5))));
    list.forEach((q, i) => {
      out[q.id] = { x: origin.x + (i % perRow) * (NODE_W + 24), y: top + Math.floor(i / perRow) * (QUOTE_H + ROW_GAP) };
    });
    top += Math.ceil(list.length / perRow) * (QUOTE_H + ROW_GAP) + 64;
  }
}

/** Hand-placed positions always win over the automatic layout. */
export function withPinned(auto: Positions, pinned: Record<string, Pos>): Positions {
  const out: Positions = { ...auto };
  for (const [id, p] of Object.entries(pinned)) if (id in out) out[id] = p;
  return out;
}

type ElkNode = { id: string; x?: number; y?: number; width: number; height: number };
type ElkGraph = { id: string; layoutOptions: Record<string, string>; children: ElkNode[]; edges: { id: string; sources: string[]; targets: string[] }[] };
export type ElkLike = { layout(g: ElkGraph): Promise<ElkGraph> };

/** elkjs layered layout for the main pipeline; quotes and standalone admin box are placed cleanly. */
export async function elkLayout(elk: ElkLike, nodes: GNode[], edges: GEdge[]): Promise<Positions> {
  const main = nodes.filter((n) => n.kind !== "quote" && n.kind !== "ai_config");
  const ids = new Set(main.map((n) => n.id));
  const g = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(COL_GAP),
      "elk.spacing.nodeNode": String(ROW_GAP),
      "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
      "elk.layered.crossingMinimization.semiInteractive": "true",
    },
    children: main.map((n, i) => ({ id: n.id, width: NODE_W, height: nodeHeight(n.kind), layoutOptions: { "elk.position": `(0,${i})` } }) as ElkNode),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  const out: Positions = {};
  // Centre the result vertically on the idea node so it lines up with the synchronous layout.
  const idea = g.children.find((c) => c.id === "idea");
  const dy = idea ? -(idea.y ?? 0) - NODE_H / 2 : 0;
  for (const c of g.children) out[c.id] = { x: c.x ?? 0, y: (c.y ?? 0) + dy };
  // Place the Admin AI Engine box neatly above the Idea node so it never crowds the pipeline.
  const adminNode = nodes.find((n) => n.kind === "ai_config");
  if (adminNode) {
    const ideaPos = out.idea ?? { x: 0, y: -NODE_H / 2 };
    out[adminNode.id] = { x: ideaPos.x, y: ideaPos.y - nodeHeight("ai_config") - ROW_GAP };
  }
  packQuotes(nodes, out);
  return out;
}
