"use client";
// Small notes about what the user has already looked at in a review ("opened a paper", "looked at this
// article"), kept in this browser only. They tick off the checklists on the screens; nothing on the server
// depends on them.
import { useCallback, useSyncExternalStore } from "react";

export interface Marks {
  /** Things done at least once, by name ("opened-paper", "read-synthesis"). */
  seen: string[];
  /** Article analyses the user has looked at, by id. */
  reviewed: string[];
}
const EMPTY: Marks = { seen: [], reviewed: [] };
const key = (projectId: string) => `athena-marks:${projectId}`;
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: Marks }>();

function read(projectId: string): Marks {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key(projectId));
  } catch {}
  const hit = cache.get(projectId);
  if (hit && hit.raw === raw) return hit.value;
  let value = EMPTY;
  try {
    const v = raw ? (JSON.parse(raw) as Partial<Marks>) : null;
    if (v) value = { seen: Array.isArray(v.seen) ? v.seen : [], reviewed: Array.isArray(v.reviewed) ? v.reviewed : [] };
  } catch {}
  cache.set(projectId, { raw, value });
  return value;
}

function write(projectId: string, next: Marks) {
  try {
    localStorage.setItem(key(projectId), JSON.stringify(next));
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useMarks(projectId: string) {
  const marks = useSyncExternalStore(subscribe, () => read(projectId), () => EMPTY);
  const markSeen = useCallback((flag: string) => {
    const m = read(projectId);
    if (!m.seen.includes(flag)) write(projectId, { ...m, seen: [...m.seen, flag] });
  }, [projectId]);
  const markReviewed = useCallback((id: string) => {
    const m = read(projectId);
    if (!m.reviewed.includes(id)) write(projectId, { ...m, reviewed: [...m.reviewed, id] });
  }, [projectId]);
  return { ...marks, markSeen, markReviewed };
}
