"use client";

const ORDER = ["population", "setting", "phenomenon", "context", "method", "outcome"];

function wrap(label: string, max = 22): string[] {
  const words = label.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > max && cur) {
      lines.push(cur);
      cur = w;
    } else cur = (cur + " " + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.length > 2 ? [lines[0], `${lines[1].slice(0, max - 1)}…`] : lines;
}

/** One row per concept kind (population → outcome), nodes spread across each row, edges as labelled curves. */
export function ConceptMap({ map }: { map: { nodes: { id: string; label: string; kind: string }[]; edges: { from: string; to: string; label: string }[] } }) {
  const kinds = ORDER.filter((k) => map.nodes.some((n) => n.kind === k));
  const W = 600;
  const rowH = 86;
  const H = kinds.length * rowH + 10;
  const nodeW = 168;
  const nodeH = 44;
  const pos = new Map<string, { x: number; y: number }>();
  kinds.forEach((k, ri) => {
    const ns = map.nodes.filter((n) => n.kind === k);
    ns.forEach((n, ci) => pos.set(n.id, { x: 90 + (W - 100) * ((ci + 0.5) / ns.length), y: 30 + ri * rowH }));
  });
  return (
    <div>
      <svg role="img" aria-label="Concept map of the research idea" viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill="var(--fg-2)" />
          </marker>
        </defs>
        {kinds.map((k, ri) => (
          <text key={k} x={4} y={34 + ri * rowH} style={{ fontSize: 12, fill: "var(--fg-2)" }}>{k}</text>
        ))}
        {map.edges.map((e, i) => {
          const a = pos.get(e.from);
          const b = pos.get(e.to);
          if (!a || !b) return null;
          const down = b.y >= a.y;
          const sameRow = Math.abs(a.y - b.y) < 1;
          const sy = sameRow ? a.y : a.y + (down ? nodeH / 2 : -nodeH / 2);
          const ey = sameRow ? b.y : b.y + (down ? -nodeH / 2 : nodeH / 2);
          const sx = sameRow ? a.x + Math.sign(b.x - a.x) * nodeW / 2 : a.x;
          const ex = sameRow ? b.x - Math.sign(b.x - a.x) * nodeW / 2 : b.x;
          const midY = (sy + ey) / 2;
          const d = sameRow ? `M${sx},${sy} L${ex},${ey}` : `M${sx},${sy} C${sx},${midY} ${ex},${midY} ${ex},${ey}`;
          return (
            <g key={i}>
              <path d={d} fill="none" stroke="var(--line-control)" strokeWidth={1.5} markerEnd="url(#arrow)" />
              <text x={(sx + ex) / 2 + 6} y={midY + (sameRow ? -5 : 4)} style={{ fontSize: 12, fill: "var(--fg-1)" }} paintOrder="stroke" stroke="var(--bg-1)" strokeWidth={4}>{e.label}</text>
            </g>
          );
        })}
        {map.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const lines = wrap(n.label);
          return (
            <g key={n.id}>
              <title>{`${n.label} (${n.kind})`}</title>
              <rect x={p.x - nodeW / 2} y={p.y - nodeH / 2} width={nodeW} height={nodeH} rx={9} fill="var(--bg-2)" stroke="var(--line-control)" strokeWidth={1} />
              {lines.map((l, i) => (
                <text key={i} x={p.x} y={p.y + 4 + (i - (lines.length - 1) / 2) * 14} textAnchor="middle" style={{ fontSize: 12, fill: "var(--fg-0)" }}>{l}</text>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
