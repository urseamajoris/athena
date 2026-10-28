"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AnimatePresence } from "motion/react";
import { Command, LayoutGrid, List as ListIcon, X } from "lucide-react";
import { useApi } from "../api";
import { Badge, ErrorState, Kbd, Loading, cx } from "../ui";
import { MotionRoot } from "../motion";
import { AppMenu } from "../AppMenu";
import { SessionProvider, canvasStore, useCanvas, useSession } from "../session/SessionContext";
import { StageRail } from "./StageRail";
import { ListView } from "./ListView";
import { FocusPanel } from "./FocusPanel";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { canvasCommands, focusNode } from "./focus";
import { STAGE_KEY_TO_NODE, nodeForStage } from "@/lib/canvas/graph";

const CanvasView = dynamic(() => import("./CanvasView"), { ssr: false, loading: () => <Loading label="Drawing the canvas…" /> });
const CommandPalette = dynamic(() => import("./CommandPalette"), { ssr: false });

function subscribe(cb: () => void) {
  const mq = window.matchMedia("(max-width: 767px)");
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}
export function useIsMobile() {
  return useSyncExternalStore(subscribe, () => window.matchMedia("(max-width: 767px)").matches, () => false);
}

export function SessionShell({ projectId }: { projectId: string }) {
  return (
    <MotionRoot>
      <SessionProvider
        projectId={projectId}
        fallback={(s) =>
          s ? (
            <main id="main" className="mx-auto max-w-xl p-8"><ErrorState error={s.error} onRetry={s.retry} title="Could not open this session" /><Link href="/sessions" className="btn-secondary mt-4">All sessions</Link></main>
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
  const { graph, ui, projectId, error, clearError, project } = useSession();
  const mobile = useIsMobile();
  const view = ui.view ?? (mobile ? "list" : "canvas");
  const panel = useCanvas((s) => s.panel);
  const palette = useCanvas((s) => s.palette);
  const shortcuts = useCanvas((s) => s.shortcuts);
  const [paletteLoaded, setPaletteLoaded] = useState(false);
  const panelNode = panel ? graph.nodes.find((n) => n.id === panel) ?? null : null;
  const { data: status } = useApi<{ mockMode: boolean }>("/api/status");

  // ?node=<id or old stage key> opens that node once; afterwards the URL follows the open panel.
  const params = useSearchParams();
  const handledParam = useRef(false);
  useEffect(() => {
    if (handledParam.current) return;
    handledParam.current = true;
    // A fresh session view: nothing selected or open from a previous session, then apply ?node=.
    canvasStore.getState().closePanel();
    canvasStore.getState().select(null);
    const p = params.get("node");
    if (!p) return;
    const id = graph.nodes.some((n) => n.id === p) ? p : STAGE_KEY_TO_NODE[p] ? nodeForStage(graph, STAGE_KEY_TO_NODE[p]) : null;
    if (id) canvasStore.getState().openPanel(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
    <button className={cx("inline-flex h-11 items-center gap-2 rounded-sm px-3", view === v ? "bg-bg-3 text-fg-0" : "text-fg-1 hover:text-fg-0")} aria-pressed={view === v} onClick={() => canvasStore.getState().setView(projectId, v)} title={`${label} (L)`}>
      <Icon className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      <span className={mobile ? "sr-only" : ""}>{label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 flex flex-col bg-bg-0">
      <header className="relative z-20 flex h-12 shrink-0 items-center gap-3 border-b border-line bg-bg-0 px-2 md:px-4">
        <Link href="/sessions" className="inline-flex h-11 shrink-0 items-center gap-2 rounded-sm px-1 font-semibold" aria-label="Athena: all sessions">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-line-strong bg-bg-2 text-12">A</span>
          <span className="hidden lg:inline">Athena</span>
        </Link>
        <h1 className="hidden min-w-0 max-w-64 truncate font-medium text-fg-1 xl:block" title={project.idea}>{project.title || project.idea}</h1>
        <div className="flex min-w-0 flex-1 justify-center">
          <StageRail compact={mobile} />
        </div>
        {status?.mockMode && !mobile && <Badge title="MOCK_MODE: recorded API fixtures and canned model responses; nothing is spent">Mock data</Badge>}
        <div className="flex items-center rounded-md border border-line p-px" role="group" aria-label="View">
          {viewBtn("canvas", "Canvas", LayoutGrid)}
          {viewBtn("list", "List", ListIcon)}
        </div>
        <button className="btn-ghost h-11 px-2" onClick={() => { setPaletteLoaded(true); canvasStore.getState().setPalette(true); }} aria-label="Command palette (⌘K or /)">
          <Command className="h-4 w-4" strokeWidth={1.5} aria-hidden />
          {!mobile && <Kbd>K</Kbd>}
        </button>
        <AppMenu onShortcuts={() => canvasStore.getState().setShortcuts(true)} />
      </header>
      <main id="main" className="relative flex-1 overflow-hidden" aria-label={view === "list" ? "Review list" : "Review canvas"}>
        {view === "canvas" ? <CanvasView readOnly={mobile} /> : <ListView />}
        {error ? (
          <div className="absolute left-1/2 top-4 z-30 w-[min(560px,calc(100vw-32px))] -translate-x-1/2">
            <div className="relative">
              <ErrorState error={error} title="That did not work" />
              <button className="btn-ghost absolute right-1 top-1 h-11 w-11 px-0" onClick={clearError} aria-label="Dismiss the error"><X className="h-4 w-4" strokeWidth={1.5} aria-hidden /></button>
            </div>
          </div>
        ) : null}
      </main>
      <AnimatePresence>{panelNode && <FocusPanel key={panelNode.id} node={panelNode} mobile={mobile} />}</AnimatePresence>
      {paletteLoaded && (
        <CommandPalette
          open={palette}
          onClose={() => canvasStore.getState().setPalette(false)}
          onFit={() => canvasCommands.fit()}
          onShortcuts={() => canvasStore.getState().setShortcuts(true)}
        />
      )}
      <ShortcutsDialog open={shortcuts} onClose={() => canvasStore.getState().setShortcuts(false)} />
    </div>
  );
}
