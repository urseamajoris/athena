"use client";
import Link from "next/link";
import { Table2 } from "lucide-react";
import { Disclosure } from "../disclosure";
import { useSession } from "../session/SessionContext";
import { ActionButton, JobLog, JobStatus, PanelFooter, SectionTitle, Stat, StaleNotice } from "./common";
import { nextAction } from "@/lib/canvas/actions";
import { MIN_TOPIC_FIT, PER_TOPIC, RUBRIC } from "@/lib/shared/stages";
import { topicCoverage } from "@/lib/scoring";
import { fmtInt } from "@/lib/shared/format";

/** Table node (stages 5–6): summary rows, then ranking; the full table opens on its own page. */
export function TablePanel() {
  const { projectId, summary, states, graph, input } = useSession();
  const node = graph.nodes.find((n) => n.id === "table");
  const action = node ? nextAction(node, graph, input) : null;
  const t = summary?.table;
  const ranking = summary?.ranking ?? [];
  const activeStage = states["5"] === "approved" ? 6 : 5;
  const { short, few } = topicCoverage(ranking);
  return (
    <div className="space-y-4">
      <StaleNotice stage={5} also={[6]} />
      <JobStatus stage={activeStage} />
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Rows" value={fmtInt(t?.papers ?? 0)} />
        <Stat label="Summarised by AI" value={`${fmtInt(t?.summarised ?? 0)}${t?.edited ? ` · ${t.edited} edited` : ""}`} />
      </div>
      <Link href={`/s/${projectId}/table`} className="btn-secondary w-full">
        <Table2 className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Open the full table
      </Link>
      {states["6"] !== "not_started" && states["6"] !== "running" && ranking.some((r) => r.scored) && (
        <section aria-label="Selected papers per topic">
          <SectionTitle>Selected for appraisal, by topic importance</SectionTitle>
          <ul className="divide-y divide-line rounded-md border border-line">
            {ranking.map((r) => (
              <li key={r.topicId} className="flex items-center gap-3 px-3 py-2">
                <span className="w-8 shrink-0 text-12 tabular-nums text-fg-2">#{r.importanceRank ?? "–"}</span>
                <span className="min-w-0 flex-1 truncate">{r.name}</span>
                <span className={`text-12 tabular-nums ${r.selected < 3 || r.selected > 5 ? "text-warn" : "text-fg-1"}`}>{r.selected} of {r.scored}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-12 text-fg-2">
            Aim for 3–5 papers per topic. Pick and swap papers in the full table.
            {short.length > 0 && ` Fewer than ${PER_TOPIC.min} are selected in ${short.length === 1 ? "1 topic" : `${short.length} topics`} although more papers match.`}
            {few.length > 0 && ` Fewer than ${PER_TOPIC.min} papers match ${few.length === 1 ? "1 topic" : `${few.length} topics`} (${few.map((r) => r.name).join(", ")}): papers that do not match a topic are not selected for it.`}
          </p>
        </section>
      )}
      <Disclosure title="How papers are scored">
        <ul className="space-y-1">
          {RUBRIC.map((r) => (
            <li key={r.key}><strong className="font-medium">{r.label}</strong> <span className="tabular-nums text-fg-2">{Math.round(r.weight * 100)}%</span> · {r.by === "AI" ? "scored by the AI from title and abstract" : "a fixed formula"}</li>
          ))}
        </ul>
        <p className="mt-2 text-12 text-fg-2">Total = weighted sum out of 100. The 4 best-scoring papers per topic are pre-selected, but only papers that match the topic (topic fit {MIN_TOPIC_FIT}/5 or more).</p>
      </Disclosure>
      <JobLog stage={activeStage} />
      {action && (
        <PanelFooter>
          <ActionButton action={action} primary showReason />
        </PanelFooter>
      )}
    </div>
  );
}
