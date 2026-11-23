// The landing-page demo: a session growing on the canvas. Rendered once at build time
// (scripts/render-demo.mjs); Remotion is a dev dependency only and never ships to the browser.
import { AbsoluteFill, Easing, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender } from "remotion";
import { useEffect, useState, type ReactNode } from "react";
import { BookOpenCheck, Check, CheckCircle2, CircleDot, FileSearch, Lightbulb, Library, ListTree, Network, Sigma, Table2, X } from "lucide-react";

// Design tokens (dark theme), mirrored from src/app/globals.css.
const T = { bg0: "#0a0a0b", bg1: "#111113", bg2: "#18181b", line: "#2a2a30", lineStrong: "#3a3a42", control: "#70707a", fg0: "#f5f5f7", fg1: "#b4b4bd", fg2: "#8a8a94", accent: "#7c9cff", ok: "#3dd68c", warn: "#f5b547", err: "#ff6b6b", run: "#5ec8ff" };
const W = 236;
const H = 116;
const IDEA = "How do health systems in Southeast Asia adopt telemedicine?";

type Kind = "Idea" | "Topic" | "Query" | "Corpus" | "Table" | "Appraisal" | "Synthesis" | "Questions";
const ICON = { Idea: Lightbulb, Topic: Network, Query: FileSearch, Corpus: Library, Table: Table2, Appraisal: BookOpenCheck, Synthesis: Sigma, Questions: ListTree } as const;

interface N { id: string; kind: Kind; title: string; key: string; x: number; y: number; at: number; parent?: string }
const COL = (c: number) => 80 + c * 300;
const NODES: N[] = [
  { id: "idea", kind: "Idea", title: IDEA, key: "4 topics", x: COL(0), y: 342, at: 34 },
  { id: "t1", kind: "Topic", title: "Adoption and uptake", key: "5 synonyms · 1 MeSH", x: COL(1), y: 130, at: 50, parent: "idea" },
  { id: "t2", kind: "Topic", title: "Barriers and facilitators", key: "4 synonyms · 1 MeSH", x: COL(1), y: 270, at: 56, parent: "idea" },
  { id: "t3", kind: "Topic", title: "Policy and governance", key: "5 synonyms · 0 MeSH", x: COL(1), y: 410, at: 62, parent: "idea" },
  { id: "t4", kind: "Topic", title: "Digital infrastructure", key: "3 synonyms · 2 MeSH", x: COL(1), y: 550, at: 68, parent: "idea" },
  { id: "q1", kind: "Query", title: "Adoption and uptake", key: "PubMed 979 · OpenAlex 1,630", x: COL(2), y: 130, at: 92, parent: "t1" },
  { id: "q2", kind: "Query", title: "Barriers and facilitators", key: "PubMed 9,245 · OpenAlex 707", x: COL(2), y: 270, at: 96, parent: "t2" },
  { id: "q3", kind: "Query", title: "Policy and governance", key: "PubMed 8,058 · OpenAlex 451", x: COL(2), y: 410, at: 100, parent: "t3" },
  { id: "q4", kind: "Query", title: "Digital infrastructure", key: "PubMed 2,207 · OpenAlex 305", x: COL(2), y: 550, at: 104, parent: "t4" },
  { id: "corpus", kind: "Corpus", title: "Retrieved papers", key: "", x: COL(3), y: 342, at: 118 },
  { id: "table", kind: "Table", title: "Summary & ranking", key: "195 rows · 20 selected", x: COL(4), y: 342, at: 172, parent: "corpus" },
  { id: "appraisal", kind: "Appraisal", title: "Appraisal", key: "16 papers · 7 full text", x: COL(5), y: 342, at: 188, parent: "table" },
  { id: "synthesis", kind: "Synthesis", title: "Synthesis", key: "15 statements · 2 conflicts", x: COL(6), y: 342, at: 206, parent: "appraisal" },
  { id: "questions", kind: "Questions", title: "Which organisational factors shape telemedicine uptake in rural ASEAN clinics?", key: "3 candidates · 1 chosen", x: COL(7), y: 342, at: 222, parent: "synthesis" },
];
const byId = Object.fromEntries(NODES.map((n) => [n.id, n]));
const EDGES: [string, string][] = [
  ...NODES.filter((n) => n.parent).map((n) => [n.parent!, n.id] as [string, string]),
  ["q1", "corpus"], ["q2", "corpus"], ["q3", "corpus"], ["q4", "corpus"],
];

function useInter() {
  const [handle] = useState(() => delayRender("Loading Inter"));
  useEffect(() => {
    const f = new FontFace("Inter", `url(${staticFile("inter.woff2")}) format("woff2")`, { weight: "400 600" });
    f.load().then((ff) => {
      document.fonts.add(ff);
      continueRender(handle);
    });
  }, [handle]);
}

function Card({ n, appear, children, status }: { n: N; appear: number; children?: ReactNode; status: ReactNode }) {
  const I = ICON[n.kind];
  const p = byId[n.parent ?? ""];
  const dx = p ? (p.x - n.x) * (1 - appear) : 0;
  const dy = p ? (p.y - n.y) * (1 - appear) : (1 - appear) * 60;
  return (
    <div style={{ position: "absolute", left: n.x, top: n.y, width: W, height: H, opacity: Math.min(1, appear * 1.6), transform: `translate(${dx}px, ${dy}px) scale(${0.9 + 0.1 * appear})`, background: T.bg1, border: `1px solid ${T.lineStrong}`, borderRadius: 10, padding: 12, boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.fg2 }}>
        <I size={16} strokeWidth={1.5} />
        <span style={{ flex: 1 }}>{n.kind}</span>
        {status}
      </div>
      <div style={{ marginTop: 8, fontSize: 14, lineHeight: "20px", fontWeight: 500, color: T.fg0, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{n.title}</div>
      <div style={{ marginTop: 4, fontSize: 12, color: T.fg1, display: "flex", gap: 8, alignItems: "center", fontVariantNumeric: "tabular-nums" }}>{children ?? n.key}</div>
    </div>
  );
}

const Status = ({ text, color, icon }: { text: string; color: string; icon: ReactNode }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, fontWeight: 500, color }}>{icon}{text}</span>
);

export function CanvasDemo() {
  useInter();
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const appear = (at: number) => spring({ frame: frame - at, fps, config: { stiffness: 400, damping: 30 }, durationInFrames: 14 });

  // Camera: start on the idea and topics, follow the review to the right, then pull back to show the
  // whole graph (the graph is the result). Final framing: x 80..2416, y 130..666 fitted into 1280×800.
  const ease = { easing: Easing.bezier(0.2, 0, 0, 1), extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
  const fit = (1280 - 120) / (COL(7) + W - COL(0));
  const camX = interpolate(frame, [0, 96, 160, 236, 256], [0, 0, -520, -1340, 60 - COL(0) * fit], ease);
  const camY = interpolate(frame, [236, 256], [0, 400 - 398 * fit], ease);
  const zoom = interpolate(frame, [236, 256], [1, fit], ease);
  const fadeOut = interpolate(frame, [durationInFrames - 16, durationInFrames - 1], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // The prompt on the empty canvas, then it hands over to the Idea node.
  const typed = IDEA.slice(0, Math.round(interpolate(frame, [2, 28], [0, IDEA.length], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })));
  const promptOpacity = interpolate(frame, [30, 38], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  // Retrieval: live count and a progress ring while edges flow into the corpus.
  const running = frame >= 118 && frame < 164;
  const progress = interpolate(frame, [118, 162], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const count = Math.round(195 * progress);
  const verified = Math.round(interpolate(frame, [192, 214], [0, 153], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }));

  const done = <Status text="Done" color={T.ok} icon={<CheckCircle2 size={12} strokeWidth={2} />} />;
  return (
    <AbsoluteFill style={{ background: T.bg0, fontFamily: "Inter, sans-serif", fontFeatureSettings: '"cv11", "ss01"', color: T.fg0 }}>
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(${T.line} 1px, transparent 1px)`, backgroundSize: "24px 24px" }} />
      <AbsoluteFill style={{ opacity: fadeOut }}>
        <div style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", transform: `translate(${camX}px, ${camY}px) scale(${zoom})` }}>
          <svg width={3000} height={800} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
            {EDGES.map(([a, b]) => {
              const s = byId[a];
              const t = byId[b];
              const shown = appear(Math.max(s.at, t.at) + 4);
              if (shown <= 0.01) return null;
              const x1 = s.x + W, y1 = s.y + H / 2, x2 = t.x, y2 = t.y + H / 2;
              const mid = (x1 + x2) / 2;
              const flowing = b === "corpus" && running;
              const len = Math.hypot(x2 - x1, y2 - y1) * 1.2;
              return (
                <path key={a + b} d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`} fill="none" stroke={flowing ? T.run : T.control} strokeWidth={1.5}
                  strokeDasharray={flowing ? "6 4" : `${len}`} strokeDashoffset={flowing ? -frame * 0.6 : len * (1 - shown)} />
              );
            })}
          </svg>
          {NODES.map((n) => {
            const a = appear(n.at);
            if (a <= 0.01) return null;
            if (n.id === "corpus")
              return (
                <Card key={n.id} n={n} appear={a} status={running ? <Status text="Running" color={T.run} icon={<Ring p={progress} />} /> : done}>
                  {running ? `${count} papers so far` : "195 papers, 205 dupes removed"}
                </Card>
              );
            if (n.id === "appraisal")
              return (
                <Card key={n.id} n={n} appear={a} status={done}>
                  <span style={{ flex: 1 }}>{n.key}</span>
                  <span style={{ color: T.ok, display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={12} strokeWidth={2} />{verified}</span>
                  <span style={{ color: T.err, display: "inline-flex", alignItems: "center", gap: 4 }}><X size={12} strokeWidth={2} />17</span>
                </Card>
              );
            if (n.id === "questions")
              return (
                <Card key={n.id} n={n} appear={a} status={<Status text="Needs review" color={T.warn} icon={<CircleDot size={12} strokeWidth={2} />} />} />
              );
            return <Card key={n.id} n={n} appear={a} status={done} />;
          })}
        </div>
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", opacity: promptOpacity, pointerEvents: "none" }}>
          <div style={{ width: 640, textAlign: "center" }}>
            <div style={{ fontSize: 28, fontWeight: 600 }}>What do you want to understand?</div>
            <div style={{ marginTop: 24, textAlign: "left", background: T.bg1, border: `1px solid ${T.control}`, borderRadius: 6, padding: "12px 16px", fontSize: 16, lineHeight: "24px", minHeight: 48, color: T.fg0 }}>
              {typed}
              <span style={{ display: "inline-block", width: 2, height: 20, marginLeft: 1, verticalAlign: "-4px", background: T.fg0, opacity: Math.floor(frame / 8) % 2 ? 0 : 1 }} />
            </div>
          </div>
        </AbsoluteFill>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

function Ring({ p }: { p: number }) {
  const r = 5.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" style={{ transform: "rotate(-90deg)" }}>
      <circle cx={7} cy={7} r={r} fill="none" stroke={T.lineStrong} strokeWidth={3} />
      <circle cx={7} cy={7} r={r} fill="none" stroke={T.run} strokeWidth={3} strokeLinecap="round" strokeDasharray={`${c * p} ${c}`} />
    </svg>
  );
}
