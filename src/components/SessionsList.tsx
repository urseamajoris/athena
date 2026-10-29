"use client";
import { LogoMark } from "./Logo";
import { useMemo, useState } from "react";
import Link from "next/link";
import { TransitionLink } from "./vt";
import { AlertTriangle, Plus } from "lucide-react";
import { api, useApi } from "./api";
import { ErrorState, Loading, StateIcon } from "./ui";
import { Disclosure } from "./disclosure";
import { MoreMenu, Modal } from "./overlays";
import { AppMenu } from "./AppMenu";
import { STAGES, type StageState } from "@/lib/shared/stages";
import { relTime } from "@/lib/shared/format";

interface ProjectRow {
  id: string;
  title: string;
  idea: string;
  currentStage: number;
  status: string;
  stageStates: Record<string, StageState>;
  createdAt: string;
  updatedAt: string;
}

/** What waits for the user on a project, in plain words. */
function nextLine(p: ProjectRow): string {
  const f = frontier(p);
  if (!f) return "Finished: download your review";
  const st = p.stageStates[String(f.n)] ?? "not_started";
  if (st === "running") return `Working on step ${f.n}: ${f.title.toLowerCase()}…`;
  if (st === "stale") return `Step ${f.n} is out of date: bring it up to date`;
  if (st === "failed") return `Step ${f.n} did not finish: try again`;
  return `Your turn: step ${f.n}, ${f.title.toLowerCase()}`;
}

/** Where to resume: the first stage not yet approved, opened in its node. */
export function resumeHref(p: ProjectRow) {
  const f = frontier(p);
  return f ? `/s/${p.id}?node=${f.key}` : `/s/${p.id}`;
}

function frontier(p: ProjectRow) {
  return STAGES.find((s) => p.stageStates[String(s.n)] !== "approved") ?? null;
}


/** Sessions: open one, or start a new one. */
export function SessionsList() {
  const { data, error, mutate } = useApi<{ projects: ProjectRow[] }>("/api/projects");
  const [sort, setSort] = useState<"updated" | "title" | "stage">("updated");
  const [filter, setFilter] = useState<"all" | "active" | "done" | "stale">("all");
  const [confirm, setConfirm] = useState<ProjectRow | null>(null);
  const [rename, setRename] = useState<{ row: ProjectRow; title: string; error?: string } | null>(null);
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
          <LogoMark />
          Athena
        </Link>
        <AppMenu />
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-28 font-semibold">My projects</h1>
            <p className="mt-1 text-fg-1">Each project is one literature review, from idea to research question in 9 steps. Open one to continue where you left off.</p>
          </div>
          <TransitionLink href="/s/new" className="btn-primary min-h-11">
            <Plus className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Start a new review
          </TransitionLink>
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
                  <option value="all">All projects</option>
                  <option value="active">In progress</option>
                  <option value="stale">With out-of-date steps</option>
                  <option value="done">Finished</option>
                </select>
              </label>
            </div>
          </Disclosure>
        </div>
        {!data && !error && <Loading />}
        {error && <div className="mt-4"><ErrorState error={error} onRetry={() => mutate()} /></div>}
        {data && data.projects.length === 0 && (
          <div className="mt-8 rounded-md border border-dashed border-line-control p-8 text-center">
            <p className="text-16 font-medium">No projects yet</p>
            <p className="mt-1 text-fg-1">Start with a rough idea: Athena walks you through the 9 steps to a research question you can defend.</p>
            <TransitionLink href="/s/new" className="btn-primary mt-4 min-h-11">Start your first review</TransitionLink>
          </div>
        )}
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((p) => {
            const f = frontier(p);
            const state: StageState = f ? p.stageStates[String(f.n)] ?? "not_started" : "approved";
            const stale = Object.values(p.stageStates).filter((s) => s === "stale").length;
            return (
              <li key={p.id} className="flex items-start rounded-md border border-line bg-bg-1 hover:border-line-strong">
                <TransitionLink href={resumeHref(p)} className="flex min-h-full flex-1 flex-col gap-2 self-stretch rounded-md p-4">
                  <span className="line-clamp-3 font-medium text-fg-0">{p.title || p.idea}</span>
                  <span className="text-12 text-fg-2" suppressHydrationWarning>Started {new Date(p.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} · edited {relTime(p.updatedAt)}</span>
                  <span className="mt-auto" aria-label={`${f ? `Step ${f.n} of 9` : "All 9 steps done"}`}>
                    <span className="flex gap-0.5" aria-hidden>
                      {STAGES.map((s) => <span key={s.n} className={`h-1.5 flex-1 rounded-full ${p.stageStates[String(s.n)] === "approved" ? "bg-ok" : s.n === f?.n ? "bg-fg-1" : p.stageStates[String(s.n)] === "stale" ? "bg-warn" : "bg-bg-3"}`} />)}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-12 text-fg-1">
                      <span className="inline-flex items-center gap-1"><StateIcon state={state} className="h-3 w-3" />{nextLine(p)}</span>
                      {stale > 0 && <span className="inline-flex items-center gap-1 text-warn"><AlertTriangle className="h-3 w-3" strokeWidth={2} aria-hidden />{f ? `Step ${f.n} changed, so ${stale} later step${stale === 1 ? "" : "s"} need${stale === 1 ? "s" : ""} updating` : `${stale} step${stale === 1 ? "" : "s"} out of date`}</span>}
                    </span>
                  </span>
                </TransitionLink>
                <div className="p-1">
                  <MoreMenu label={`Actions for ${p.title || p.idea}`} items={[{ label: "Rename", onSelect: () => setRename({ row: p, title: p.title || p.idea.slice(0, 90) }) }, { label: "Delete project", danger: true, onSelect: () => setConfirm(p) }]} />
                </div>
              </li>
            );
          })}
        </ul>
      </main>
      <Modal
        open={!!rename}
        onClose={() => setRename(null)}
        title="Rename this project"
        footer={
          <>
            <button className="btn-secondary" onClick={() => setRename(null)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!rename?.title.trim()}
              onClick={async () => {
                if (!rename) return;
                try {
                  await api(`/api/projects/${rename.row.id}`, { method: "PATCH", body: { title: rename.title } });
                  setRename(null);
                  mutate();
                } catch (e) {
                  setRename({ ...rename, error: (e as Error).message });
                }
              }}
            >
              Save name
            </button>
          </>
        }
      >
        <label className="label block">Name<input className="input mt-1 w-full" value={rename?.title ?? ""} maxLength={120} onChange={(e) => rename && setRename({ ...rename, title: e.target.value, error: undefined })} /></label>
        <p className="mt-2 text-12 text-fg-2">Only the name changes. Your research idea and every step stay as they are.</p>
        {rename?.error && <p role="alert" className="mt-2 text-err">{rename.error}</p>}
      </Modal>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete this project?"
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
