// "What happens in this step": one 8-second explainer per stage, rendered to video at build time
// (scripts/render-explainers.mjs). Three plain-language beats, each with a small schematic animation.
// The same beats are shown as text next to the video (src/lib/shared/explainers.ts), so nothing is video-only.
import { AbsoluteFill, Easing, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, delayRender, continueRender } from "remotion";
import { useEffect, useState, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { EXPLAINERS } from "../src/lib/shared/explainers";

const T = { bg0: "#0a0a0b", bg1: "#111113", bg2: "#18181b", bg3: "#222226", line: "#2a2a30", lineStrong: "#3a3a42", fg0: "#f5f5f7", fg1: "#b4b4bd", fg2: "#8a8a94", accent: "#7c9cff", ok: "#3dd68c", warn: "#f5b547", err: "#ff6b6b", run: "#5ec8ff" };
const CAT = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#2a9a2a"];
const crisp = { damping: 22, stiffness: 180, mass: 0.9 };
const soft = { damping: 30, stiffness: 90, mass: 1.1 };
export const BEAT = 72; // frames per beat (2.4 s); 3 beats + 24 frames of hold = 240 frames (8 s)

function useInter() {
  const [handle] = useState(() => delayRender("Loading Inter"));
  useEffect(() => {
    const f = new FontFace("Inter", `url(${staticFile("inter.woff2")}) format("woff2")`, { weight: "400 700" });
    f.load().then((ff) => {
      document.fonts.add(ff);
      continueRender(handle);
    });
  }, [handle]);
}

const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
function useAppear(at: number, cfg = crisp) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({ frame: frame - at, fps, config: cfg });
}

function Pop({ at, children, dy = 16, style }: { at: number; children: ReactNode; dy?: number; style?: React.CSSProperties }) {
  const a = useAppear(at);
  return <div style={{ opacity: a, transform: `translateY(${(1 - a) * dy}px)`, filter: `blur(${(1 - a) * 4}px)`, ...style }}>{children}</div>;
}

const Chip = ({ children, color = T.lineStrong, fg = T.fg0, mono = false }: { children: ReactNode; color?: string; fg?: string; mono?: boolean }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, border: `2px solid ${color}`, borderRadius: 10, padding: "8px 14px", fontSize: 26, color: fg, fontFamily: mono ? "monospace" : undefined, background: T.bg1 }}>{children}</span>
);

/** The schematic for each stage, driven by the current frame. */
function Visual({ stage }: { stage: number }) {
  const frame = useCurrentFrame();
  const b1 = 0, b2 = BEAT, b3 = BEAT * 2;
  switch (stage) {
    case 1: {
      const idea = "Does sleep affect grades in university?";
      const typed = idea.slice(0, Math.round(interpolate(frame, [6, 50], [0, idea.length], clamp)));
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 22, width: 760 }}>
          <div style={{ border: `2px solid ${T.lineStrong}`, borderRadius: 12, padding: "18px 22px", fontSize: 30, background: T.bg1, minHeight: 40 }}>{typed}<span style={{ opacity: frame % 30 < 15 ? 1 : 0 }}>|</span></div>
          <Pop at={b2}><div style={{ alignSelf: "flex-start", background: T.bg3, borderRadius: 14, padding: "14px 20px", fontSize: 26, color: T.fg1, width: 560 }}>Which students: first-year, or all?</div></Pop>
          <Pop at={b2 + 22}><div style={{ marginLeft: 200, background: T.bg2, border: `2px solid ${T.line}`, borderRadius: 14, padding: "14px 20px", fontSize: 26, width: 420 }}>First-year undergraduates</div></Pop>
          <Pop at={b3 + 10}><Chip color={T.ok} fg={T.ok}><Check size={26} strokeWidth={3} /> You approve it</Chip></Pop>
        </div>
      );
    }
    case 2: {
      const topics = ["Sleep duration", "Academic performance", "Screen time at night", "Shift and part-time work"];
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 60 }}>
          <Pop at={b1}><Chip>Your idea</Chip></Pop>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {topics.map((t, i) => (
              <Pop key={t} at={b1 + 14 + i * 6}>
                <Chip color={CAT[i]}>{t}{frame > b2 + i * 6 && <span style={{ fontSize: 20, color: T.fg2 }}>+ {3 + i} synonyms</span>}</Chip>
              </Pop>
            ))}
          </div>
          <Pop at={b3}><div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 24, color: T.fg1 }}><span>✓ Accept</span><span>✎ Edit</span><span>✕ Delete</span></div></Pop>
        </div>
      );
    }
    case 3: {
      const pub = Math.round(interpolate(frame, [b2, b2 + 40], [0, 1630], clamp));
      const oa = Math.round(interpolate(frame, [b2 + 8, b2 + 48], [0, 979], clamp));
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 26, alignItems: "flex-start" }}>
          <Pop at={b1}><div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", width: 900 }}><Chip mono>sleep</Chip><span style={{ fontSize: 24, color: T.fg2 }}>OR</span><Chip mono>insomnia</Chip><span style={{ fontSize: 24, color: T.fg2 }}>AND</span><Chip mono>grades</Chip><span style={{ fontSize: 24, color: T.fg2 }}>OR</span><Chip mono>GPA</Chip></div></Pop>
          <div style={{ display: "flex", gap: 24 }}>
            <Pop at={b2}><Chip color={T.run}>PubMed <b style={{ fontVariantNumeric: "tabular-nums" }}>{pub.toLocaleString()}</b> hits</Chip></Pop>
            <Pop at={b2 + 8}><Chip color={T.run}>OpenAlex <b style={{ fontVariantNumeric: "tabular-nums" }}>{oa.toLocaleString()}</b> hits</Chip></Pop>
          </div>
          <Pop at={b3}><span style={{ fontSize: 26, color: T.fg1 }}>Counted first. Nothing is fetched until you approve.</span></Pop>
        </div>
      );
    }
    case 4: {
      const dots = Array.from({ length: 27 }, (_, i) => i);
      return (
        <div style={{ position: "relative", width: 900, height: 340 }}>
          <div style={{ position: "absolute", left: 0, top: 0 }}><Chip color={T.run}>PubMed</Chip></div>
          <div style={{ position: "absolute", right: 0, top: 0 }}><Chip color={T.run}>OpenAlex</Chip></div>
          {dots.map((i) => {
            const fromLeft = i % 2 === 0;
            const start = 8 + i * 3;
            const p = interpolate(frame, [start, start + 30], [0, 1], { ...clamp, easing: Easing.bezier(0.2, 0, 0, 1) });
            const dup = i % 7 === 3;
            const merged = frame > b2 + 10 && dup;
            const x = interpolate(p, [0, 1], [fromLeft ? 70 : 830, 330 + (i % 9) * 30]);
            const y = interpolate(p, [0, 1], [60, 170 + Math.floor(i / 9) * 34]);
            return <div key={i} style={{ position: "absolute", left: x, top: y, width: 20, height: 20, borderRadius: 10, background: dup ? T.warn : T.fg1, opacity: p * (merged ? 0.15 : 1), transform: `scale(${merged ? 0.4 : 1})` }} />;
          })}
          <Pop at={b2 + 14} style={{ position: "absolute", left: 330, top: 290 }}><span style={{ fontSize: 24, color: T.warn }}>● found twice: merged into one</span></Pop>
          <Pop at={b3} style={{ position: "absolute", left: 0, right: 0, top: 100, textAlign: "center" }}><span style={{ fontSize: 28, color: T.fg0 }}>23 unique papers · 4 duplicates removed</span></Pop>
        </div>
      );
    }
    case 5: {
      const rows = ["Sleep and GPA in nursing students", "Night-time screen use and exams", "Insomnia in first-year students", "Part-time work and sleep"];
      return (
        <div style={{ width: 960, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1.4fr", gap: 16, fontSize: 20, color: T.fg2, padding: "0 16px" }}><span>Paper</span><span>Study type</span><span>Key finding</span></div>
          {rows.map((r, i) => {
            const fill = frame > b2 + i * 8;
            return (
              <Pop key={r} at={b1 + 8 + i * 6}>
                <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1fr 1.4fr", gap: 16, alignItems: "center", fontSize: 22, background: T.bg1, border: `2px solid ${T.line}`, borderRadius: 10, padding: "12px 16px" }}>
                  <span>{r}</span>
                  <span style={{ display: "flex", gap: 8, alignItems: "center", color: fill ? T.fg0 : T.bg3 }}><span style={{ width: 14, height: 14, borderRadius: i === 1 ? 2 : 7, background: fill ? CAT[i] : T.bg3 }} />{fill ? ["Cohort", "Cross-sectional", "Trial", "Qualitative"][i] : "……"}</span>
                  <span style={{ color: fill ? T.fg1 : T.bg3 }}>{fill ? "AI · from the abstract" : "……"}{frame > b3 && i === 2 ? <b style={{ color: T.ok }}> ✎ corrected</b> : null}</span>
                </div>
              </Pop>
            );
          })}
        </div>
      );
    }
    case 6: {
      const scores = [92, 71, 88, 54, 80];
      const order = frame > b2 ? [0, 2, 4, 1, 3] : [0, 1, 2, 3, 4];
      return (
        <div style={{ position: "relative", width: 860, height: 330 }}>
          {scores.map((s, i) => {
            const pos = order.indexOf(i);
            const y = spring({ frame: frame - b2, fps: 30, config: soft });
            const top = (frame > b2 ? interpolate(y, [0, 1], [i, pos]) : i) * 64;
            const w = interpolate(frame, [b1 + 6, b1 + 40], [0, s * 6], clamp);
            const selected = frame > b2 + 30 && pos < 3;
            return (
              <div key={i} style={{ position: "absolute", top, left: 0, display: "flex", alignItems: "center", gap: 18 }}>
                <span style={{ width: 120, fontSize: 22, color: T.fg1 }}>Paper {String.fromCharCode(65 + i)}</span>
                <div style={{ width: w, height: 30, borderRadius: 6, background: selected ? T.accent : T.lineStrong }} />
                <span style={{ fontSize: 24, fontVariantNumeric: "tabular-nums" }}>{s}</span>
                {selected && <span style={{ fontSize: 22, color: T.accent }}>selected</span>}
                {frame > b3 + 10 && pos === 3 && <span style={{ fontSize: 22, color: T.fg1 }}>⇄ swap in</span>}
              </div>
            );
          })}
        </div>
      );
    }
    case 7: {
      const hi = interpolate(frame, [b2, b2 + 24], [0, 1], clamp);
      return (
        <div style={{ display: "flex", gap: 40, alignItems: "flex-start", width: 1000 }}>
          <div style={{ width: 520, fontSize: 22, lineHeight: "34px", color: T.fg1, background: T.bg1, border: `2px solid ${T.line}`, borderRadius: 12, padding: 20 }}>
            We surveyed 412 first-year students. <span style={{ background: `rgba(245,181,71,${0.35 * hi})`, color: hi > 0.5 ? T.fg0 : T.fg1 }}>Students sleeping under six hours had lower exam scores</span> after adjusting for course load.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <Pop at={b1 + 10}><Chip>“Students sleeping under six hours had lower exam scores”</Chip></Pop>
            <Pop at={b2 + 26}><Chip color={T.ok} fg={T.ok}><Check size={24} strokeWidth={3} /> Found in the source</Chip></Pop>
            <Pop at={b3}><Chip color={T.err} fg={T.err}><X size={24} strokeWidth={3} /> Not found: you decide</Chip></Pop>
          </div>
        </div>
      );
    }
    case 8: {
      const cols = [{ t: "Known", c: T.ok }, { t: "Contested", c: T.warn }, { t: "Unknown", c: T.fg2 }];
      return (
        <div style={{ display: "flex", gap: 28 }}>
          {cols.map((col, ci) => (
            <div key={col.t} style={{ width: 280, display: "flex", flexDirection: "column", gap: 12 }}>
              <Pop at={b1 + ci * 6}><div style={{ fontSize: 26, fontWeight: 600, color: col.c, borderBottom: `3px solid ${col.c}`, paddingBottom: 8 }}>{col.t}</div></Pop>
              {[0, 1].map((k) => (
                <Pop key={k} at={b2 + ci * 8 + k * 6}>
                  <div style={{ background: T.bg1, border: `2px solid ${T.line}`, borderRadius: 10, padding: 12, fontSize: 20, color: T.fg1 }}>
                    {["Short sleep → lower grades", "Effect larger in exams", "Screens: mixed results", "Effect size differs by country", "Long-term effects", "Interventions in Asia"][ci * 2 + k]}
                    {frame > b3 && <div style={{ marginTop: 6, fontSize: 18, color: T.accent }}>2 quotes ↗</div>}
                  </div>
                </Pop>
              ))}
            </div>
          ))}
        </div>
      );
    }
    default: {
      const qs = ["Does sleep duration predict first-year GPA?", "Do sleep programmes improve exam scores?", "How do students explain late nights?"];
      return (
        <div style={{ display: "flex", gap: 22 }}>
          {qs.map((q, i) => {
            const chosen = frame > b3 && i === 0;
            return (
              <Pop key={q} at={b1 + i * 8}>
                <div style={{ width: 300, height: 220, background: T.bg1, border: `3px solid ${chosen ? T.accent : T.line}`, borderRadius: 12, padding: 18, fontSize: 24, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                  <span>{q}</span>
                  {frame > b2 && <span style={{ fontSize: 18, color: T.fg2 }}>gap · feasibility · weakness · novelty search</span>}
                  {chosen && <span style={{ fontSize: 20, color: T.accent }}>✓ Your question</span>}
                </div>
              </Pop>
            );
          })}
        </div>
      );
    }
  }
}

export function StageExplainer({ stage }: { stage: number }) {
  useInter();
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const e = EXPLAINERS[stage - 1];
  const beat = Math.min(2, Math.floor(frame / BEAT));
  const fade = interpolate(frame, [0, 8, durationInFrames - 10, durationInFrames - 1], [0, 1, 1, 0], clamp);
  return (
    <AbsoluteFill style={{ background: T.bg0, color: T.fg0, fontFamily: "Inter, sans-serif", opacity: fade }}>
      <AbsoluteFill style={{ backgroundImage: `radial-gradient(${T.line} 1.5px, transparent 1.5px)`, backgroundSize: "32px 32px", opacity: 0.6 }} />
      <div style={{ position: "absolute", left: 90, top: 56, right: 90 }}>
        <div style={{ fontSize: 24, letterSpacing: "0.18em", textTransform: "uppercase", color: T.fg2 }}>Step {stage} of 9</div>
        <div style={{ fontSize: 52, fontWeight: 700, marginTop: 6 }}>{e.title}</div>
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, top: 200, height: 360, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Visual stage={stage} />
      </div>
      <div style={{ position: "absolute", left: 90, right: 90, bottom: 48, display: "flex", alignItems: "center", gap: 24 }}>
        <div style={{ display: "flex", gap: 10 }}>{[0, 1, 2].map((i) => <div key={i} style={{ width: 36, height: 6, borderRadius: 3, background: i <= beat ? T.accent : T.lineStrong }} />)}</div>
        <Pop key={beat} at={beat * BEAT} dy={10}><div style={{ fontSize: 32, fontWeight: 500 }}>{e.beats[beat]}</div></Pop>
      </div>
    </AbsoluteFill>
  );
}
