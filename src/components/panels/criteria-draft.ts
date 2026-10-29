"use client";
import { useSyncExternalStore } from "react";

/**
 * Unsaved edits to a project's search criteria, kept outside the Query panel so they survive closing it or
 * switching topics, and so actions elsewhere (the canvas card, the ⋯ menu) can tell that they exist.
 */
export interface StoredDraft<D, C> { draft: D; base: C }
const drafts = new Map<string, StoredDraft<unknown, unknown>>();
const unsaved = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const criteriaDrafts = {
  get<D, C>(projectId: string) {
    return drafts.get(projectId) as StoredDraft<D, C> | undefined;
  },
  set<D, C>(projectId: string, value: StoredDraft<D, C>, dirty: boolean) {
    drafts.set(projectId, value);
    if (dirty !== unsaved.has(projectId)) {
      if (dirty) unsaved.add(projectId);
      else unsaved.delete(projectId);
      emit();
    }
  },
  clear(projectId: string) {
    drafts.delete(projectId);
    if (unsaved.delete(projectId)) emit();
  },
  hasUnsaved: (projectId: string) => unsaved.has(projectId),
};

export function useUnsavedCriteria(projectId: string): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => unsaved.has(projectId),
    () => false,
  );
}
