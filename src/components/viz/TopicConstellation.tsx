"use client";
import dynamic from "next/dynamic";
import { useReducedMotion, useTheme, useVizMode } from "./support";
import { shapePath } from "../categories";
import { Legend } from "../categories";
import { slotVar, topicCategories } from "@/lib/shared/categories";

const TopicConstellation3D = dynamic(() => import("./TopicConstellation3D"), { ssr: false, loading: () => <div className="h-[320px]" /> });

interface T { id: string; name: string; synonyms: string[]; controlledTerms: string[] }

/** The idea in the middle, each search topic around it (its colour and shape are the topic's everywhere), with its
 *  keywords orbiting it. 3D with WebGL; a flat drawing otherwise. The legend and caption carry the same facts. */
export function TopicConstellation({ idea, topics }: { idea: string; topics: T[] }) {
  const mode = useVizMode();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const cats = topicCategories(topics);
  const label = `Your idea connected to ${topics.length} search topics: ${topics.map((t) => `${t.name} (${t.synonyms.length} synonyms, ${t.controlledTerms.length} MeSH terms)`).join("; ")}.`;
  return (
    <figure>
      {mode === "3d" ? (
        <TopicConstellation3D idea={idea} topics={topics} theme={theme} animate={!reduced} label={label} />
      ) : (
        <svg viewBox="0 0 400 260" className="h-[260px] w-full" role="img" aria-label={label}>
          <circle cx={200} cy={130} r={12} fill="var(--fg-0)" />
          <text x={200} y={156} textAnchor="middle" fontSize="11" fill="var(--fg-1)">Your idea</text>
          {topics.map((t, i) => {
            const a = (i / topics.length) * Math.PI * 2 - Math.PI / 2;
            const x = 200 + Math.cos(a) * 140;
            const y = 130 + Math.sin(a) * 95;
            const c = cats[i];
            return (
              <g key={t.id}>
                <line x1={200} y1={130} x2={x} y2={y} stroke="var(--line-strong)" />
                <path d={shapePath(c?.shape ?? "circle")} transform={`translate(${x - 9} ${y - 9}) scale(1.1)`} fill={slotVar(c?.slot ?? null)} fillRule="evenodd" />
                <text x={x} y={y + 22} textAnchor="middle" fontSize="10" fill="var(--fg-0)">{t.name.length > 28 ? `${t.name.slice(0, 26)}…` : t.name}</text>
              </g>
            );
          })}
        </svg>
      )}
      <Legend dim="topic" topics={topics} className="mt-2" title="Each topic keeps this colour and shape in every view" />
      <figcaption className="mt-1 text-12 text-fg-2">{mode === "3d" ? "Small dots orbiting a topic are its keywords (synonyms and MeSH terms). Drag to turn it." : "Lines join your idea to each search topic."}</figcaption>
    </figure>
  );
}
