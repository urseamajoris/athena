"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Plus } from "lucide-react";
import { api, useApi } from "./api";
import { Disclosure, ErrorState, Loading, MoreMenu, Modal, StateIcon, cx } from "./ui";
import { AppMenu } from "./AppMenu";
import { STAGES, STATE_LABEL, type StageState } from "@/lib/shared/stages";

interface ProjectRow {
  id: string;
  title: string;
  idea: string;
  currentStage: number;
  status: string;
  stageStates: Record<string, StageState>;
  updatedAt: string;
}

function frontier(p: ProjectRow) {
  return STAGES.find((s) => p.stageStates[String(s.n)] !== "approved") ?? null;
}

const rel = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
function ago(iso: string) {
  const mins = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (Math.abs(mins) < 60) return rel.format(mins, "minute");
  const h = Math.round(mins / 60);
  if (Math.abs(h) < 24) return rel.format(h, "hour");
  return rel.format(Math.round(h / 24), "day");
}

/** Sessions: open one, or start a new one. */
export function SessionsList() {
  const { data, error, isLoading, mutate } = useApi<{ projects: ProjectRow[] }>("/api/projects");
  const [sort, setSort] = useState<"updated" | "title" | "stage">("updated");
  const [filter, setFilter] = useState<"all" | "active" | "done" | "stale">("all");
  const [confirm, setConfirm] = useState<ProjectRow | null>(null);
  const rows = useMemo(() => {
    const list = (data?.projects ?? []).filter((p) => {
      const stale = Object.values(p.stageStates).some((s) => s === "stale");
      return filter === "all" || (filter === "done" ? p.status === "complete" : filter === "stale" ? stale : p.status !== "complete");
    });
    return [...list].sort((a, b) => (sort === "title" ? (a.title || a.idea).localeCompare(b.title || b.idea) : sort === "stage" ? (frontier(b)?.n ?? 10) - (frontier(a)?.n ?? 10) : b.updatedAt.localeCompare(a.updatedAt)));
  }, [data, sort, filter]);

  return (
    <div className="min-h-screen bg-bg-0">
      <header className="flex h-12 items-center justify-between border-b border-line px-2 md:px-4">
        <Link href="/" className="inline-flex h-11 items-center gap-2 rounded-sm px-1 font-semibold" aria-label="Athena home">
          <span aria-hidden className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-line-strong bg-bg-2 text-12">A</span>
          Athena
        </Link>
        <AppMenu />
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-20 font-semibold">Sessions</h1>
          <Link href="/s/new" className="btn-primary min-h-11">
            <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> New session
          </Link>
        </div>
        <div className="mt-4">
          <Disclosure title="Sort and filter" meta={`${rows.length} of ${data?.projects.length ?? 0}`}>
            <div className="flex flex-wrap gap-4">
              <label className="text-12 text-fg-1">Sort by
                <select className="input mt-1 w-48" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
                  <option value="updated">Last edited</option>
                  <option value="title">Title</option>
                  <option value="stage">Furthest along</option>
                </select>
              </label>
              <label className="text-12 text-fg-1">Show
                <select className="input mt-1 w-48" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
                  <option value="all">All sessions</option>
                  <option value="active">In progress</option>
                  <option value="stale">With stale steps</option>
                  <option value="done">Finished</option>
                </select>
              </label>
            </div>
          </Disclosure>
        </div>
        {isLoading && <Loading />}
        {error && <div className="mt-4"><ErrorState error={error} onRetry={() => mutate()} /></div>}
        {data && data.projects.length === 0 && <p className="mt-8 text-fg-2">No sessions yet. Your first one will appear here.</p>}
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => {
            const f = frontier(p);
            const state: StageState = f ? p.stageStates[String(f.n)] ?? "not_started" : "approved";
            const stale = Object.values(p.stageStates).filter((s) => s === "stale").length;
            return (
              <li key={p.id} className="relative flex flex-col rounded-md border border-line bg-bg-1 hover:border-line-strong">
                <Link href={`/s/${p.id}`} className="flex flex-1 flex-col gap-2 rounded-md p-4 pr-12">
                  <span className="line-clamp-3 font-medium text-fg-0">{p.title || p.idea}</span>
                  <span className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-1">
                    <span className="inline-flex items-center gap-1"><StateIcon state={state} className="h-3 w-3" />{f ? `${f.n}. ${f.title} · ${STATE_LABEL[state].toLowerCase()}` : "Finished"}</span>
                    {stale > 0 && <span className="inline-flex items-center gap-1 text-warn"><AlertTriangle className="h-3 w-3" strokeWidth={2} aria-hidden />{stale} stale</span>}
                    <span className="text-fg-2">edited {ago(p.updatedAt)}</span>
                  </span>
                </Link>
                <div className={cx("absolute right-1 top-1")}>
                  <MoreMenu label={`Actions for ${p.title || p.idea}`} items={[{ label: "Delete session", danger: true, onSelect: () => setConfirm(p) }]} />
                </div>
              </li>
            );
          })}
        </ul>
      </main>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete this session?"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setConfirm(null)}>Keep it</button>
            <button className="btn-danger" onClick={async () => { if (!confirm) return; await api(`/api/projects/${confirm.id}`, { method: "DELETE" }); setConfirm(null); mutate(); }}>Delete</button>
          </>
        }
      >
        <p>“{confirm?.title}” and everything in it (papers, appraisals, synthesis, decision log) will be deleted. This cannot be undone.</p>
      </Modal>
    </div>
  );
}
