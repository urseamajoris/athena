"use client";
import { projectPath, useApi } from "../api";
import { Badge, EmptyState, ErrorState, Loading, ProgressBar } from "../ui";
import { JobPanel, SectionTitle, useJobRefresh, useWizard } from "../wizard/Wizard";

interface Run { id: string; database: string; topicName: string; queryString: string; status: string; resultCount: number | null; fetchedCount: number; newUniqueCount: number; cap: number; error: string | null }
interface RetrievalData { uniquePapers: number; runs: Run[] }

export function RetrievalStage() {
  const { projectId, states, live } = useWizard();
  const { data: fetched, error, isLoading, mutate } = useApi<RetrievalData>(projectPath(projectId, "retrieval"));
  useJobRefresh(4, mutate);
  const data = (live?.retrieval as RetrievalData | null) ?? fetched;
  if (states["3"] !== "approved" && (states["4"] ?? "not_started") === "not_started") return <EmptyState title="Approve the search queries first">Retrieval runs every approved query against its database.</EmptyState>;
  if (isLoading && !data) return <Loading />;
  if (error && !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  const runs = data?.runs ?? [];
  const failed = runs.filter((r) => r.status === "failed");
  const failedDbs = [...new Set(failed.map((r) => r.database))];
  let cumulative = 0;
  const maxNew = Math.max(1, ...runs.map((r) => r.newUniqueCount));

  return (
    <div className="space-y-4">
      <JobPanel stage={4} runLabel="Run retrieval" />
      {failed.length > 0 && (
        <div role="alert" className="rounded-md border border-err-line bg-err-soft px-4 py-3 text-14 text-err">
          <strong>{failed.length} quer{failed.length === 1 ? "y" : "ies"} failed</strong> ({failedDbs.join(", ")}). The other sources continued, so you can still go on with the papers that were found, or re-run later.
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Unique papers" value={data?.uniquePapers ?? 0} />
        <Stat label={failed.length ? `Queries succeeded (${failed.length} failed)` : "Queries succeeded"} value={`${runs.filter((r) => r.status === "done").length} / ${runs.length}`} />
        <Stat label="Records fetched (before dedup)" value={runs.reduce((a, r) => a + r.fetchedCount, 0)} />
      </div>
      <section className="card overflow-x-auto p-4">
        <SectionTitle>Queries, in run order</SectionTitle>
        <p className="mb-3 text-12 text-fg-2">“New unique” counts papers not already found by an earlier query. When it drops toward zero, extra queries are returning papers you already have.</p>
        <table className="w-full min-w-[720px] text-14">
          <thead>
            <tr className="border-b border-line text-left text-12 text-fg-2">
              <th className="py-2 pr-2">#</th><th className="pr-2">Topic</th><th className="pr-2">Database</th><th className="w-48 pr-2">Progress</th><th className="pr-2 text-right">Total hits</th><th className="pr-2 text-right">Fetched</th><th className="w-40 pr-2">New unique</th><th className="pr-2 text-right">Cumulative</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => {
              cumulative += r.newUniqueCount;
              const target = Math.min(r.cap, r.resultCount ?? r.cap);
              return (
                <tr key={r.id} className="border-b border-line align-top">
                  <td className="py-2 pr-2 text-fg-2">{i + 1}</td>
                  <td className="pr-2"><span className="font-medium text-fg-0">{r.topicName}</span><code className="mt-1 block max-w-xs truncate text-12 text-fg-2" title={r.queryString}>{r.queryString}</code></td>
                  <td className="pr-2">{r.database}</td>
                  <td className="pr-2">
                    {r.status === "failed" ? <Badge tone="rose" title={r.error ?? ""}>failed</Badge> : <ProgressBar value={r.status === "done" ? target : r.fetchedCount} max={Math.max(1, target)} label={`${r.topicName} ${r.database}`} />}
                    <span className="mt-1 block text-12 text-fg-2">{r.status}{r.error ? `: ${r.error.slice(0, 120)}` : ""}</span>
                  </td>
                  <td className="pr-2 text-right tabular-nums">{r.resultCount?.toLocaleString() ?? "–"}</td>
                  <td className="pr-2 text-right tabular-nums">{r.fetchedCount}</td>
                  <td className="pr-2">
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-sm bg-bg-2"><div className="h-2 rounded-sm bg-ok" style={{ width: `${(r.newUniqueCount / maxNew) * 100}%` }} /></div>
                      <span className="w-8 text-right tabular-nums">{r.newUniqueCount}</span>
                    </div>
                  </td>
                  <td className="pr-2 text-right tabular-nums text-fg-1">{cumulative}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!runs.length && <p className="py-4 text-14 text-fg-2">No queries have run yet.</p>}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-12 text-fg-2">{label}</p>
      <p className="text-20 font-semibold tabular-nums text-fg-0">{value}</p>
    </div>
  );
}
