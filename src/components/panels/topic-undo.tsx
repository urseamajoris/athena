"use client";
import { useEffect, useRef, useState } from "react";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import { Trash2 } from "lucide-react";
import { api, projectPath } from "../api";
import { Spinner, cx } from "../ui";
import { useSession } from "../session/SessionContext";

/** How long Undo stays on screen after a topic is deleted (kept while the pointer or focus is on it). */
const UNDO_MS = 10_000;

interface Deleted { projectId: string; id: string; name: string; at: number }

/**
 * The last topic deleted, wherever it was deleted from (topic list, topic editor, canvas card, menu, Escape):
 * every delete goes through the session's "dismissTopic" command, which records it here so Undo can be shown.
 */
export const topicUndo = createStore<{ last: Deleted | null; show(d: Omit<Deleted, "at">): void; clear(id?: string): void }>()((set, get) => ({
  last: null,
  show: (d) => set({ last: { ...d, at: Date.now() } }),
  clear: (id) => {
    if (!id || get().last?.id === id) set({ last: null });
  },
}));

/** "Deleted the topic X. Undo" for a few seconds after a delete; Undo puts the topic back where it was. */
export function TopicUndo({ className }: { className?: string }) {
  const { projectId, refresh, announce } = useSession();
  const last = useStore(topicUndo, (s) => s.last);
  const mine = last && last.projectId === projectId ? last : null;
  const [hold, setHold] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!mine || hold || busy) return;
    const t = setTimeout(() => topicUndo.getState().clear(mine.id), Math.max(1000, UNDO_MS - (Date.now() - mine.at)));
    return () => clearTimeout(t);
  }, [mine, hold, busy]);
  // The control that deleted the topic is gone with it: when focus fell to the page, it moves to Undo.
  useEffect(() => {
    setErr(null);
    if (mine && (!document.activeElement || document.activeElement === document.body)) ref.current?.focus({ preventScroll: true });
  }, [mine]);

  if (!mine) return null;
  async function undo() {
    if (!mine) return;
    setBusy(true);
    setErr(null);
    try {
      await api(projectPath(projectId, `topics/${mine.id}/restore`), { body: {} });
      topicUndo.getState().clear(mine.id);
      await refresh();
      announce(`The topic ${mine.name} is back.`);
      requestAnimationFrame(() =>
        // In order of preference (querySelector with a selector list would return the first in the document instead).
        [`[data-topic-row="${CSS.escape(mine.id)}"]`, `[data-list-node="topic:${CSS.escape(mine.id)}"] > button`, `[data-node-id="topic:${CSS.escape(mine.id)}"]`]
          .map((sel) => document.querySelector<HTMLElement>(sel))
          .find(Boolean)
          ?.focus(),
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      role="status"
      className={cx("flex flex-wrap items-center gap-2 rounded-sm border border-line-strong bg-bg-1 px-3 py-1 text-fg-0", className)}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={() => setHold(false)}
    >
      <Trash2 className="h-4 w-4 shrink-0 text-fg-1" strokeWidth={1.5} aria-hidden />
      <span className="min-w-0 flex-1">Deleted the topic “{mine.name}”.</span>
      <button ref={ref} className="btn-secondary btn-sm" disabled={busy} onClick={undo} aria-label={`Undo: bring back the topic ${mine.name}`}>{busy && <Spinner />} Undo</button>
      {err && <span className="w-full text-12 text-err">{err}</span>}
    </div>
  );
}
