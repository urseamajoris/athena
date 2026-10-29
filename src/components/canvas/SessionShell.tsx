"use client";
import { LogoMark } from "../Logo";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { TransitionLink } from "../vt";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { Command, LayoutGrid, List as ListIcon, X } from "lucide-react";
import { useApi } from "../api";
import { ErrorState, Kbd, Loading, cx } from "../ui";
import { MotionRoot } from "../motion";
import { useHydrated } from "../hydrated";
import { AppMenu } from "../AppMenu";
import { SessionProvider, canvasStore, useCanvas, useSession } from "../session/SessionContext";
import { StageRail } from "./StageRail";
import { canvasCommands, focusNode } from "./focus";
import { AiPausedBanner } from "../session/AiPausedBanner";
import { STAGE_KEY_TO_NODE, nodeForStage } from "@/lib/canvas/graph";
// Only shown when a review cannot be opened: loaded then, not with every canvas.
const SessionUnavailable = dynamic(() => import("../session/SessionUnavailable").then((m) => m.SessionUnavailable), { ssr: false });

const CanvasView = dynamic(() => import("./CanvasView"), { ssr: false, loading: () => <Loading label="Drawing the canvas…" /> });
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });
// Server-rendered: before hydration the viewport is unknown, so phones get the List view in the first HTML.
const ListView = dynamic(() => import("./ListView").then((m) => m.ListView), { loading: () => <Loading /> });
const FocusPanel = dynamic(() => import("./FocusPanel").then((m) => m.FocusPanel), { ssr: false });
const ShortcutsDialog = dynamic(() => import("./ShortcutsDialog").then((m) => m.ShortcutsDialog), { ssr: false });

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(max-width: 767px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia("(max-width: 767px)").matches, () => false);
}
function subscribeTablet(cb: () => void) {
  const mq = window.matchMedia("(max-width: 1023px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
/** Below 1024 px the canvas is too small to read: the List view is the default there. */
export function useIsNarrow() {
  return useSyncExternalStore(subscribeTablet, () => window.matchMedia("(max-width: 1023px)").matches, () => false);
}

export function SessionShell({ projectId }: { projectId: string }) {
  return (
    <MotionRoot>
      <SessionProvider
        projectId={projectId}
        fallback={(s) =>
          s ? (
            <SessionUnavailable error={s.error} retry={s.retry} />
          ) : (
            <main id="main" className="p-8"><Loading label="Opening your session…" /></main>
          )
        }
      >
        <Shell />
      </SessionProvider>
    </MotionRoot>
  );
}

function Shell() {
  const { graph, ui, projectId, error, clearError, project, summary, claims } = useSession();
  // The sessions list is prefetched once the canvas has loaded, not while it competes for the network.
  const router = useRouter();
  const loaded = !!summary;
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => router.prefetch("/sessions"), 3000);
    return () => clearTimeout(t);
  }, [loaded, router]);
  const mobile = useIsMobile();
  const narrow = useIsNarrow();
  const hydrated = useHydrated();
  const view = ui.view ?? (narrow ? "list" : "canvas");
  const panel = useCanvas((s) => s.panel);
  const palette = useCanvas((s) => s.palette);
  const shortcuts = useCanvas((s) => s.shortcuts);
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  // The side panel starts below the header and any banner (AI paused or not set up), so it never covers it.
  const topRef = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(48);
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setTop(Math.round(el.getBoundingClientRect().height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const panelNode = panel ? graph.nodes.find((n) => n.id === panel) ?? null : null;

  // ?node=<id or old stage key> opens that node once; afterwards the URL follows the open panel.
  const params = useSearchParams();
  const handledParam = useRef(false);
  const reset = useRef(false);
  useEffect(() => {
    if (!reset.current) {
      // A fresh session view: nothing selected or open from a previous session.
      reset.current = true;
      canvasStore.getState().closePanel();
      canvasStore.getState().select(null);
    }
    if (handledParam.current) return;
    const p = params.get("node");
    const id = !p ? null : graph.nodes.some((n) => n.id === p) ? p : STAGE_KEY_TO_NODE[p] ? nodeForStage(graph, STAGE_KEY_TO_NODE[p]) : null;
    // Topic, query and quote nodes appear once their data has loaded; wait for it before giving up.
    const loaded = !!summary && (!p?.startsWith("quote:") || claims !== null);
    if (p && !id && !loaded) return;
    handledParam.current = true;
    if (id) canvasStore.getState().openPanel(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, summary, claims]);
  useEffect(() => {
    if (!handledParam.current) return;
    const url = new URL(window.location.href);
    if (panel) url.searchParams.set("node", panel);
    else url.searchParams.delete("node");
    if (url.toString() !== window.location.href) window.history.replaceState(window.history.state, "", url);
  }, [panel]);
  // A panel whose node disappeared (topic deleted, quote unpinned) closes.
  useEffect(() => {
    if (panel && !panelNode) canvasStore.getState().closePanel();
  }, [panel, panelNode]);

  // Global keyboard shortcuts (node keys live on the canvas).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const st = canvasStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteLoaded(true);
        st.setPalette(!st.palette);
        return;
      }
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || t.closest("input,textarea,select,[contenteditable=true],[role=dialog],[role=menu],[role=listbox]")) return;
      if (e.key === "/") {
        e.preventDefault();
        setPaletteLoaded(true);
        st.setPalette(true);
      } else if (e.key === "?") {
        e.preventDefault();
        st.setShortcuts(true);
      } else if (/^[1-9]$/.test(e.key)) {
        const id = nodeForStage(graph, Number(e.key));
        if (id) {
          e.preventDefault();
          st.select(id);
          focusNode(id);
        }
      } else if (e.key === "m" || e.key === "M") {
        if (t.closest("[data-node-id]") && e.shiftKey) return;
        st.toggleMinimap(projectId);
      } else if (e.key === "l" || e.key === "L") {
        st.setView(projectId, view === "list" ? "canvas" : "list");
      } else if (e.key === "Escape" && st.panel) {
        st.closePanel();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [graph, projectId, view]);

  const viewBtn = (v: "canvas" | "list", label: string, Icon: typeof ListIcon) => (
    <button className={cx("inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-sm px-3", view === v ? "bg-bg-3 text-fg-0" : "text-fg-1 hover:text-fg-0")} aria-pressed={view === v} onClick={() => canvasStore.getState().setView(projectId, v)} title={`${label} (L)`}>
      <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      <span className={mobile ? "sr-only" : ""}>{label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-bg-0">
      <div ref={topRef} className="shrink-0">
      <header className="relative z-20 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg-0 px-2 md:px-4">
        <TransitionLink href="/sessions" prefetch={false} className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-sm px-1 font-semibold" aria-label="Athena: all sessions">
          <LogoMark />
          <span className="hidden lg:inline">Athena</span>
        </TransitionLink>
        <h1 className="hidden min-w-0 max-w-64 truncate font-medium text-fg-1 xl:block" title={project.idea}>{project.title || project.idea}</h1>
        <div className="flex min-w-0 flex-1 justify-center">
          {hydrated ? (
            <StageRail compact={narrow} />
          ) : (
            <>
              <span className="contents lg:hidden"><StageRail compact /></span>
              <span className="hidden lg:contents"><StageRail compact={false} /></span>
            </>
          )}
        </div>
        <div className="flex items-center rounded-md border border-line" role="group" aria-label="View">
          {viewBtn("canvas", "Canvas", LayoutGrid)}
          {viewBtn("list", "List", ListIcon)}
        </div>
        {/* Named in words (a bare "⌘ K" said nothing to a first-time user): a tooltip everywhere, the word where it fits. */}
        <button className="btn-ghost h-11 min-w-11 px-2" onClick={() => { setPaletteLoaded(true); canvasStore.getState().setPalette(true); }} aria-label="Search and commands (⌘K or /)" title="Search and commands (⌘K or /)">
          <Command className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          <span className="hidden lg:inline">Search</span>
          <span className="hidden md:contents"><Kbd>K</Kbd></span>
        </button>
        <AppMenu onShortcuts={() => canvasStore.getState().setShortcuts(true)} />
      </header>
      <AiPausedBanner />
      </div>
      <main id="main" className="relative flex-1 overflow-hidden" aria-label={view === "list" ? "Review list" : "Review canvas"}>
        {!hydrated ? (
          <>
            <div className="h-full md:hidden"><ListView /></div>
            <div className="hidden h-full md:block"><Loading label="Drawing the canvas…" /></div>
          </>
        ) : view === "canvas" ? (
          <CanvasView readOnly={mobile} />
        ) : (
          <ListView />
        )}
        {error ? (
          <div className="absolute left-1/2 top-4 z-30 w-[min(560px,calc(100vw-32px))] -translate-x-1/2">
            <div className="relative">
              <ErrorState error={error} title="That did not work" />
              <button className="btn-ghost absolute right-1 top-1 h-11 w-11 px-0" onClick={clearError} aria-label="Dismiss the error"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
            </div>
          </div>
        ) : null}
      </main>
      <AnimatePresence>{panelNode && <FocusPanel key={panelNode.id} node={panelNode} mobile={mobile} top={top} />}</AnimatePresence>
      {paletteLoaded && (
        <CommandPalette
          open={palette}
          onClose={() => canvasStore.getState().setPalette(false)}
          onFit={() => canvasCommands.fit()}
          onShortcuts={() => canvasStore.getState().setShortcuts(true)}
        />
      )}
      {shortcuts && <ShortcutsDialog open onClose={() => canvasStore.getState().setShortcuts(false)} />}
    </div>
  );
}
