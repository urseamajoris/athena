"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, projectPath } from "../api";
import { useSession } from "./SessionContext";
import type { ColorBy, Dimension, ViewPrefs } from "@/lib/shared/categories";

/**
 * The project's saved view choices (filters, grouping, colour). Changes apply at once and are saved to the
 * server a moment later (one decision-log entry per pause, not per click); they appear in the report export.
 */
export function useViewPrefs() {
  const { projectId, project } = useSession();
  const [prefs, setPrefs] = useState<ViewPrefs>(() => (project as { viewPrefs?: ViewPrefs | null }).viewPrefs ?? {});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const save = useCallback(
    (next: ViewPrefs) => {
      setPrefs(next);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void api(projectPath(projectId, "view"), { method: "PUT", body: next }).catch(() => {}), 1200);
    },
    [projectId],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  const colorBy: ColorBy = prefs.colorBy ?? "study";
  const filters = prefs.filters ?? {};
  return {
    prefs,
    colorBy,
    filters,
    groupBy: prefs.groupBy ?? null,
    setColorBy: (c: ColorBy) => save({ ...prefs, colorBy: c }),
    setGroupBy: (g: Dimension | null) => save({ ...prefs, groupBy: g }),
    toggle: (dim: Dimension, key: string) => {
      const cur = new Set(filters[dim] ?? []);
      if (cur.has(key)) cur.delete(key);
      else cur.add(key);
      save({ ...prefs, filters: { ...filters, [dim]: [...cur] } });
    },
    reset: () => save({ ...prefs, filters: {} }),
  };
}
