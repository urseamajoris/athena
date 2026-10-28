"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, useApi } from "./api";
import { ErrorState, Loading, StateBadge, Spinner } from "./ui";
import { STAGES, type StageState } from "@/lib/shared/stages";

interface ProjectRow {
  id: string;
  title: string;
  idea: string;
  currentStage: number;
  status: string;
  stageStates: Record<string, StageState>;
  updatedAt: string;
}

const EXAMPLE = "e.g. What is the knowledge gap in implementing telemedicine in Southeast Asia?";

export function HomeClient() {
  const router = useRouter();
  const { data, error, isLoading, mutate } = useApi<{ projects: ProjectRow[] }>("/api/projects");
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { id } = await api<{ id: string }>("/api/projects", { body: { idea } });
      router.push(`/projects/${id}?stage=1`);
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this review and everything in it? This cannot be undone.")) return;
    await api(`/api/projects/${id}`, { method: "DELETE" });
    mutate();
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <section className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Start a literature review</h1>
        <p className="mt-2 max-w-2xl text-gray-600">
          Athena walks you through nine steps: scoping your idea, searching real databases, ranking and appraising the most relevant papers, and proposing
          research questions grounded in what the literature shows. The AI proposes; you check and approve every step.
        </p>
        <form onSubmit={create} className="card mt-6 p-5">
          <label htmlFor="idea" className="label">Your research idea</label>
          <textarea id="idea" className="input min-h-28 text-base" placeholder={EXAMPLE} value={idea} onChange={(e) => setIdea(e.target.value)} />
          <p className="mt-2 text-xs text-gray-500">A sentence or a short paragraph is enough. You can refine it in the next step.</p>
          {err ? <div className="mt-3"><ErrorState error={err} title="Could not create the review" /></div> : null}
          <div className="mt-4 flex justify-end">
            <button className="btn-primary" disabled={busy || idea.trim().length < 10}>
              {busy ? <Spinner /> : null} Start review
            </button>
          </div>
        </form>
      </section>

      <section aria-labelledby="existing">
        <h2 id="existing" className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">Your reviews</h2>
        {isLoading && <Loading />}
        {error && <ErrorState error={error} onRetry={() => mutate()} />}
        {data && data.projects.length === 0 && <p className="text-sm text-gray-500">No reviews yet. Your first one will appear here.</p>}
        <ul className="space-y-2">
          {data?.projects.map((p) => {
            const st = STAGES[Math.min(8, p.currentStage - 1)];
            return (
              <li key={p.id} className="card flex items-center justify-between gap-4 px-4 py-3">
                <Link href={`/projects/${p.id}`} className="min-w-0 flex-1 hover:underline">
                  <p className="truncate font-medium text-gray-900">{p.title || p.idea}</p>
                  <p className="text-xs text-gray-500">
                    Stage {st.n}: {st.title} · updated {new Date(p.updatedAt).toLocaleString()}
                  </p>
                </Link>
                <StateBadge state={p.status === "complete" ? "approved" : (p.stageStates[String(st.n)] ?? "not_started")} />
                <button className="btn-ghost text-xs text-gray-500" onClick={() => remove(p.id)} aria-label={`Delete review ${p.title}`}>
                  Delete
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
