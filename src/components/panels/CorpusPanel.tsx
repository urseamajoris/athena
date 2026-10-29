"use client";
import { AlertTriangle } from "lucide-react";
import { projectPath, useApi } from "../api";
import { Badge, ErrorState, ProgressBar } from "../ui";
import { Disclosure } from "../disclosure";
import { useJobRefresh, useLiveRetrieval, useSession } from "../session/SessionContext";
import { ActionButton, JobLog, JobStatus, PanelFooter, Stat, StaleNotice } from "./common";
import { nextAction } from "@/lib/canvas/actions";
import { fmtInt } from "@/lib/shared/format";

interface Run { id: string; database: string; topicName: string; queryString: string; status: string; resultCount: number | null; fetchedCount: number; newUniqueCount: number; cap: number; error: string | null }
interface RetrievalData { uniquePapers: number; runs: Run[] }
const DB: Record<string, string> = { pubmed: "PubMed", openalex: "OpenAlex" };

/** Corpus node: watch retrieval live (SSE), then review deduplication. */
export function CorpusPanel() {
  const { projectId, graph, input } = useSession();
  const live = useLiveRetrieval();
  const { data: fetched, error, mutate } = useApi<RetrievalData>(projectPath(projectId, "retrieval"));
  useJobRefresh(4, mutate);
  const data = (live as RetrievalData | null) ?? fetched;
  if (error && !data) return <ErrorState error={error} onRetry={() => mutate()} />;
  const runs = data?.runs ?? [];
  const failed = runs.filter((r) => r.status === "failed");
  const fetchedTotal = runs.reduce((a, r) => a + r.fetchedCount, 0);
  const sources = [...new Set(runs.map((r) => r.database))];
  const node = graph.nodes.find((n) => n.id === "corpus");
  const action = node ? nextAction(node, graph, input) : null;
  let cumulative = 0;
  return (
    <div className="space-y-4">
      <StaleNotice stage={4} />
      <JobStatus stage={4} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Unique papers" value={fmtInt(data?.uniquePapers ?? 0)} />
        <Stat label="Duplicates removed" value={fmtInt(Math.max(0, fetchedTotal - (data?.uniquePapers ?? 0)))} />
      </div>
      <section aria-label="Per source">
        <ul className="space-y-3">
          {sources.map((db) => {
            const rs = runs.filter((r) => r.database === db);
            const done = rs.filter((r) => r.status === "done" || r.status === "failed").length;
            const f = rs.reduce((a, r) => a + r.fetchedCount, 0);
            const nu = rs.reduce((a, r) => a + r.newUniqueCount, 0);
            return (
              <li key={db}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="font-medium">{DB[db] ?? db}</span>
                  <span className="text-12 tabular-nums text-fg-1">{fmtInt(f)} fetched · {fmtInt(nu)} new · {done}/{rs.length} queries</span>
                </div>
                <ProgressBar value={done} max={rs.length} label={`${DB[db] ?? db} queries finished`} />
              </li>
            );
          })}
        </ul>
        {!runs.length && <p className="text-fg-2">No queries have run yet.</p>}
      </section>
      {failed.length > 0 && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-err-line px-3 py-2">
          <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-err" strokeWidth={1.5} aria-hidden />
          <p><strong className="text-err">{failed.length} quer{failed.length === 1 ? "y" : "ies"} failed</strong> ({[...new Set(failed.map((r) => DB[r.database] ?? r.database))].join(", ")}). The other sources continued, so you can go on with the papers that were found, or re-run later from ⋯.</p>
        </div>
      )}
      <Disclosure title="Deduplication details" meta={`${runs.length} queries`}>
        <p className="mb-2 text-12 text-fg-2">“New” counts papers no earlier query had found. When it drops toward zero, extra queries return papers you already have.</p>
        <table className="w-full text-12">
          <thead>
            <tr className="border-b border-line text-left text-fg-2">
              <th className="py-1 pr-2 font-medium">Query</th>
              <th className="pr-2 text-right font-medium">Hits</th>
              <th className="pr-2 text-right font-medium">Fetched</th>
              <th className="pr-2 text-right font-medium">New</th>
              <th className="text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              cumulative += r.newUniqueCount;
              return (
                <tr key={r.id} className="border-b border-line align-top">
                  <td className="py-2 pr-2">
                    <span className="block text-fg-0">{r.topicName}</span>
                    <span className="text-fg-2">{DB[r.database] ?? r.database}{r.status !== "done" ? ` · ${r.status}` : ""}</span>
                  </td>
                  <td className="pr-2 text-right tabular-nums">{r.resultCount == null ? "–" : fmtInt(r.resultCount)}</td>
                  <td className="pr-2 text-right tabular-nums">{r.fetchedCount}</td>
                  <td className="pr-2 text-right tabular-nums">{r.newUniqueCount}</td>
                  <td className="text-right tabular-nums text-fg-1">{cumulative}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Disclosure>
      {failed.length > 0 && (
        <Disclosure title="Failed queries" meta={`${failed.length}`}>
          <ul className="space-y-2">
            {failed.map((r) => (
              <li key={r.id}>
                <Badge tone="err">failed</Badge> <span className="font-medium">{r.topicName}</span> · {DB[r.database] ?? r.database}
                <code className="mt-1 block break-words font-mono text-12 text-fg-1">{r.queryString}</code>
                <p className="text-12 text-err">{r.error}</p>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      <JobLog stage={4} />
      {action && (
        <PanelFooter>
          <ActionButton action={action} primary showReason />
        </PanelFooter>
      )}
    </div>
  );
}
