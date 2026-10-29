// Canvas UI state (Zustand). Per-session layout and choices persist in the browser; selection, the open
// panel and dialogs do not. Server data (stages, papers, claims) stays in the fetch layer (SWR + SSE).
import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { Pos } from "./layout";

export type ViewMode = "canvas" | "list";

export interface SessionUi {
  /** Positions of nodes the user dragged by hand; auto-layout never moves these. */
  pinned: Record<string, Pos>;
  acceptedTopics: string[];
  pinnedQuotes: string[];
  /** Appraisals the user has stepped through with "Next paper". */
  reviewed: string[];
  /** null = automatic (List view below 768 px, canvas above). */
  view: ViewMode | null;
  minimap: boolean;
  /** "Re-run downstream" is in progress: re-run each stale step after the previous one is approved. */
  cascade: boolean;
  viewport: { x: number; y: number; zoom: number } | null;
}

export const DEFAULT_SESSION: SessionUi = { pinned: {}, acceptedTopics: [], pinnedQuotes: [], reviewed: [], view: null, minimap: false, cascade: false, viewport: null };

export interface AddMenuState {
  nodeId: string;
  mode: "child" | "sibling";
  /** Screen position (drag-from-handle drop point); absent = anchored to the node. */
  at?: { x: number; y: number };
  /** Canvas position to pin the new node at (drag-from-handle). */
  flowAt?: Pos;
}

export interface CanvasState {
  sessions: Record<string, SessionUi>;
  selected: string | null;
  panel: string | null;
  palette: boolean;
  shortcuts: boolean;
  addMenu: AddMenuState | null;
  /** A node that should animate in on the next canvas mount (the Idea, right after the empty canvas). */
  intro: string | null;

  select(id: string | null): void;
  openPanel(id: string): void;
  closePanel(): void;
  setPalette(open: boolean): void;
  setShortcuts(open: boolean): void;
  setAddMenu(m: AddMenuState | null): void;
  setIntro(id: string | null): void;

  pinPosition(sid: string, nodeId: string, pos: Pos): void;
  unpinPosition(sid: string, nodeId: string): void;
  resetLayout(sid: string): void;
  acceptTopics(sid: string, topicIds: string[]): void;
  pinQuotes(sid: string, claimIds: string[]): void;
  unpinQuote(sid: string, claimId: string): void;
  markReviewed(sid: string, appraisalId: string): void;
  setView(sid: string, view: ViewMode | null): void;
  toggleMinimap(sid: string): void;
  setCascade(sid: string, on: boolean): void;
  setViewport(sid: string, vp: SessionUi["viewport"]): void;
}

export const sessionOf = (s: Pick<CanvasState, "sessions">, sid: string): SessionUi => s.sessions[sid] ?? DEFAULT_SESSION;

const uniq = (a: string[]) => [...new Set(a)];

/** localStorage that tolerates SSR, private windows and blocked storage (state then lives in memory only). */
const safeLocalStorage: StateStorage = {
  getItem: (k) => {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  setItem: (k, v) => {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(k, v);
    } catch {}
  },
  removeItem: (k) => {
    try {
      if (typeof window !== "undefined") window.localStorage.removeItem(k);
    } catch {}
  },
};

export function createCanvasStore(storage?: StateStorage) {
  return createStore<CanvasState>()(
    persist(
      (set) => {
        const patch = (sid: string, fn: (s: SessionUi) => Partial<SessionUi>) =>
          set((st) => {
            const cur = sessionOf(st, sid);
            return { sessions: { ...st.sessions, [sid]: { ...cur, ...fn(cur) } } };
          });
        return {
          sessions: {},
          selected: null,
          panel: null,
          palette: false,
          shortcuts: false,
          addMenu: null,
          intro: null,

          select: (id) => set({ selected: id }),
          openPanel: (id) => set({ selected: id, panel: id }),
          closePanel: () => set({ panel: null }),
          setPalette: (palette) => set({ palette }),
          setShortcuts: (shortcuts) => set({ shortcuts }),
          setAddMenu: (addMenu) => set({ addMenu }),
          setIntro: (intro) => set({ intro }),

          pinPosition: (sid, nodeId, pos) => patch(sid, (s) => ({ pinned: { ...s.pinned, [nodeId]: { x: Math.round(pos.x), y: Math.round(pos.y) } } })),
          unpinPosition: (sid, nodeId) =>
            patch(sid, (s) => {
              const pinned = { ...s.pinned };
              delete pinned[nodeId];
              return { pinned };
            }),
          resetLayout: (sid) => patch(sid, () => ({ pinned: {} })),
          acceptTopics: (sid, ids) => patch(sid, (s) => ({ acceptedTopics: uniq([...s.acceptedTopics, ...ids]) })),
          pinQuotes: (sid, ids) => patch(sid, (s) => ({ pinnedQuotes: uniq([...s.pinnedQuotes, ...ids]) })),
          unpinQuote: (sid, id) => patch(sid, (s) => ({ pinnedQuotes: s.pinnedQuotes.filter((x) => x !== id) })),
          markReviewed: (sid, id) => patch(sid, (s) => ({ reviewed: uniq([...s.reviewed, id]) })),
          setView: (sid, view) => patch(sid, () => ({ view })),
          toggleMinimap: (sid) => patch(sid, (s) => ({ minimap: !s.minimap })),
          setCascade: (sid, cascade) => patch(sid, () => ({ cascade })),
          setViewport: (sid, viewport) => patch(sid, () => ({ viewport })),
        };
      },
      {
        name: "athena-canvas",
        version: 1,
        storage: createJSONStorage(() => storage ?? safeLocalStorage),
        partialize: (s) => ({ sessions: s.sessions }),
      },
    ),
  );
}

export type CanvasStore = ReturnType<typeof createCanvasStore>;
