// Tidy left→right layout. A synchronous layered layout renders immediately; elkjs (lazy-loaded)
// refines it. Quotes pack into a grid under their parent. Nodes the user placed by hand never move.
import { KIND_COLUMN, type GEdge, type GNode } from "./graph";

export const NODE_W = 248;
export const NODE_H = 156;
export const QUOTE_H = 116;
const COL_GAP = 80;
const ROW_GAP = 24;

export type Pos = { x: number; y: number };
export type Positions = Record<string, Pos>;

/** Column-per-stage layout, each column centred vertically. Deterministic. */
export function layeredLayout(nodes: GNode[]): Positions {
  const out: Positions = {};
  const main = nodes.filter((n) => n.kind !== "quote");
  const cols = new Map<number, GNode[]>();
  for (const n of main) {
    const c = KIND_COLUMN[n.kind];
    if (!cols.has(c)) cols.set(c, []);
    cols.get(c)!.push(n);
  }
  for (const [c, list] of cols) {
    const h = list.length * NODE_H + (list.length - 1) * ROW_GAP;
    list.forEach((n, i) => (out[n.id] = { x: c * (NODE_W + COL_GAP), y: -h / 2 + i * (NODE_H + ROW_GAP) }));
  }
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
  const mainBottom = Math.max(0, ...Object.entries(out).filter(([id]) => !id.startsWith("quote:")).map(([, p]) => p.y + NODE_H));
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
type ElkLike = { layout(g: ElkGraph): Promise<ElkGraph> };

let elkPromise: Promise<ElkLike> | null = null;
/** Lazy-load elkjs only when the canvas actually needs it (never on the landing page or in List view). */
export function loadElk(): Promise<ElkLike> {
  return (elkPromise ??= import("elkjs/lib/elk.bundled.js").then((m) => {
    const ELK = (m as unknown as { default: new () => ElkLike }).default;
    return new ELK();
  }));
}

/** elkjs layered layout for the main pipeline; quotes are packed afterwards. */
export async function elkLayout(nodes: GNode[], edges: GEdge[]): Promise<Positions> {
  const elk = await loadElk();
  const main = nodes.filter((n) => n.kind !== "quote");
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
    children: main.map((n, i) => ({ id: n.id, width: NODE_W, height: NODE_H, layoutOptions: { "elk.position": `(0,${i})` } }) as ElkNode),
    edges: edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });
  const out: Positions = {};
  // Centre the result vertically on the idea node so it lines up with the synchronous layout.
  const idea = g.children.find((c) => c.id === "idea");
  const dy = idea ? -(idea.y ?? 0) - NODE_H / 2 : 0;
  for (const c of g.children) out[c.id] = { x: c.x ?? 0, y: (c.y ?? 0) + dy };
  packQuotes(nodes, out);
  return out;
}
