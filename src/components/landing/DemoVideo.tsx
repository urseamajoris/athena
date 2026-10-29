"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pause, Play } from "lucide-react";
import { POSTER, POSTER_SET, POSTER_SIZES } from "./poster";

const QUERY = "(prefers-reduced-motion: reduce)";
function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

const ALT = "A research session growing on the canvas: an idea branches into four topics and their database queries, the queries feed one corpus of papers, then a summary table, an appraisal with verified quotes, a synthesis and research questions.";

/**
 * The looping canvas demo (rendered with Remotion at build time). The poster is server-rendered and is the
 * page's largest image, so it loads first, alone; once it has loaded and the browser is idle, the video (about
 * 260 kB) replaces it, only when motion is allowed, and can be paused (WCAG 2.2.2).
 */
export function DemoVideo() {
  const reduced = useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => true);
  const ref = useRef<HTMLVideoElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const [paused, setPaused] = useState(false);
  const [posterShown, setPosterShown] = useState(false);
  const [poster, setPoster] = useState(POSTER);
  useEffect(() => {
    const el = img.current;
    if (!el || posterShown) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
    const done = () => {
      setPoster(el.currentSrc || POSTER); // the size the browser picked, already loaded
      setPosterShown(true);
    };
    const show = () => (w.requestIdleCallback ? w.requestIdleCallback(done, { timeout: 2000 }) : setTimeout(done, 200));
    if (el.complete) show();
    else el.addEventListener("load", show, { once: true });
    return () => el.removeEventListener("load", show);
  }, [posterShown]);
  return (
    <figure className="relative mx-auto aspect-[8/5] w-full max-w-[960px] overflow-hidden rounded-lg border border-line bg-bg-0">
      {reduced || !posterShown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img ref={img} src={POSTER} srcSet={POSTER_SET} sizes={POSTER_SIZES} width={960} height={600} alt={ALT} fetchPriority="high" className="h-full w-full object-cover" />
      ) : (
        <>
          <video ref={ref} autoPlay muted loop playsInline preload="auto" poster={poster} width={960} height={600} aria-label={ALT} className="h-full w-full object-cover">
            <source src="/demo/canvas-demo.mp4" type="video/mp4" />
            <source src="/demo/canvas-demo.webm" type="video/webm" />
          </video>
          <button
            className="btn-secondary absolute bottom-3 right-3 h-11 w-11 px-0"
            aria-label={paused ? "Play the demo" : "Pause the demo"}
            onClick={() => {
              const v = ref.current;
              if (!v) return;
              if (v.paused) {
                v.play();
                setPaused(false);
              } else {
                v.pause();
                setPaused(true);
              }
            }}
          >
            {paused ? <Play className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : <Pause className="h-4 w-4" strokeWidth={1.5} aria-hidden />}
          </button>
        </>
      )}
    </figure>
  );
}
