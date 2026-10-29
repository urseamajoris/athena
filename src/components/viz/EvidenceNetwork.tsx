"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Legend, shapePath } from "../categories";
import { useReducedMotion, useTheme, useVizMode } from "./support";
import { layoutEvidence, type EvPaper, type EvStatement } from "./evidence-graph";
import { STUDY_GROUPS, categoryVar } from "@/lib/shared/categories";

const EvidenceNetwork3D = dynamic(() => import("./EvidenceNetwork3D"), { ssr: false, loading: () => <div className="h-[360px]" /> });
const KIND = { known: { label: "Known: the papers agree", color: "var(--ok)" }, contested: { label: "Contested: the papers disagree", color: "var(--warn)" }, unknown: { label: "Unknown: not yet studied", color: "var(--fg-2)" } } as const;

/** Statements joined to the papers whose quotes support them; papers coloured and shaped by study type. */
export function EvidenceNetwork({ statements, papers, onOpenPaper }: { statements: EvStatement[]; papers: EvPaper[]; onOpenPaper: (id: string) => void }) {
  const mode = useVizMode();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [isolated, setIsolated] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const g = useMemo(() => layoutEvidence(statements, papers), [statements, papers]);
  const counts: Record<string, number> = {};
  for (const p of g.papers) counts[p.group] = (counts[p.group] ?? 0) + 1;
  const k = (kind: EvStatement["kind"]) => g.statements.filter((s) => s.kind === kind).length;
  const label = `${g.statements.length} statements (${k("known")} known, ${k("contested")} contested, ${k("unknown")} unknown) supported by quotes from ${g.papers.length} papers: ${STUDY_GROUPS.filter((c) => counts[c.key]).map((c) => `${counts[c.key]} ${c.label.toLowerCase()}`).join(", ")}.`;
  const iso = isolated ?? highlight;
  return (
    <figure>
      {mode === "3d" ? (
        <EvidenceNetwork3D g={g} theme={theme} animate={!reduced} label={label} isolated={iso} onOpenPaper={onOpenPaper} />
      ) : (
        <svg viewBox={`0 0 400 ${Math.max(200, Math.max(g.statements.length, g.papers.length) * 18 + 30)}`} className="w-full" role="img" aria-label={label}>
          {g.links.map((l, i) => {
            const si = l.s;
            const pi = l.p;
            const p = g.papers[pi];
            if (iso && p.group !== iso) return null;
            return <line key={i} x1={110} y1={24 + si * 18} x2={290} y2={24 + pi * 18} stroke="var(--line-strong)" />;
          })}
          {g.statements.map((s, i) => <rect key={s.id} x={100} y={18 + i * 18} width={10} height={10} fill={KIND[s.kind].color}><title>{s.text}</title></rect>)}
          {g.papers.map((p, i) => {
            const c = STUDY_GROUPS.find((x) => x.key === p.group);
            return (
              <g key={p.id} transform={`translate(292 ${17 + i * 18})`} opacity={iso && iso !== p.group ? 0.15 : 1} className="cursor-pointer" onClick={() => onOpenPaper(p.id)}>
                <path d={shapePath(c?.shape ?? "ring")} transform="scale(0.8)" fill={categoryVar("study", p.group)} fillRule="evenodd" />
                <text x={16} y={10} fontSize="10" fill="var(--fg-1)">{p.label}</text>
              </g>
            );
          })}
        </svg>
      )}
      <ul className="mt-2 flex flex-wrap gap-3 text-12 text-fg-1" aria-label="Statement kinds">
        {(Object.keys(KIND) as (keyof typeof KIND)[]).map((kind) => (
          <li key={kind} className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5" style={{ background: KIND[kind].color }} />{KIND[kind].label} ({k(kind)})</li>
        ))}
      </ul>
      <Legend dim="study" counts={counts} isolated={isolated} highlight={highlight} onHighlight={setHighlight} onIsolate={setIsolated} className="mt-2" title="Papers, by study type (hover to highlight, click to show only one)" />
      <figcaption className="mt-1 text-12 text-fg-2">Squares are statements; each line is a quote linking a statement to the paper it came from.{mode === "3d" ? " Drag to turn." : ""}</figcaption>
    </figure>
  );
}
