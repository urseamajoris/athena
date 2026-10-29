"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { Play } from "lucide-react";
import { Disclosure } from "../disclosure";
import { EXPLAINERS } from "@/lib/shared/explainers";

const QUERY = "(prefers-reduced-motion: reduce)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export const useReducedMotion = () => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => true);

/**
 * "What happens in this step": an 8-second explainer (pre-rendered with Remotion) plus the same three lines as
 * text, so the video is never the only way to learn it. Collapsed by default; nothing loads until it opens.
 */
export function WhatHappens({ stage, defaultOpen = false }: { stage: number; defaultOpen?: boolean }) {
  const e = EXPLAINERS[stage - 1];
  if (!e) return null;
  return (
    <Disclosure title="What happens in this step" meta="8 s" defaultOpen={defaultOpen}>
      <ExplainerVideo stage={stage} />
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-fg-1">
        {e.beats.map((b) => <li key={b}>{b}</li>)}
      </ol>
    </Disclosure>
  );
}

/** The video itself: poster first, plays on request (never autoplays with sound; respects reduced motion). */
export function ExplainerVideo({ stage, loop = false, autoPlay = false, className = "" }: { stage: number; loop?: boolean; autoPlay?: boolean; className?: string }) {
  const reduced = useReducedMotion();
  const [playing, setPlaying] = useState(autoPlay && !reduced);
  const ref = useRef<HTMLVideoElement>(null);
  const e = EXPLAINERS[stage - 1];
  const alt = `${e.title}: ${e.beats.join(" ")}`;
  return (
    <div className={`relative aspect-video w-full overflow-hidden rounded-md border border-line bg-bg-0 ${className}`}>
      {playing ? (
        <video ref={ref} src={`/explainers/stage-${stage}.mp4`} poster={`/explainers/stage-${stage}.webp`} autoPlay muted playsInline loop={loop} controls={!loop} aria-label={alt} className="h-full w-full" onEnded={() => !loop && setPlaying(false)} />
      ) : (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/explainers/stage-${stage}.webp`} alt={alt} width={640} height={360} loading="lazy" decoding="async" className="h-full w-full object-cover" />
          {!reduced || !loop ? (
            <button className="absolute inset-0 flex items-center justify-center bg-transparent hover:bg-scrim/30" onClick={() => setPlaying(true)} aria-label={`Play: ${e.title} (8 seconds, no sound)`}>
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-line-strong bg-bg-1"><Play className="h-5 w-5" strokeWidth={1.5} aria-hidden /></span>
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
