"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { m } from "motion/react";
import { api, projectPath } from "../api";
import { CloseButton, Loading, MoreMenu, cx, type MenuItem } from "../ui";
import { canvasStore, useSession } from "../session/SessionContext";
import { PanelFooterSlot, useJobMenu } from "../panels/common";
import { KindIcon } from "./icons";
import { NodeStatusBadge } from "./NodeCard";
import { KIND_LABEL, type GNode } from "@/lib/canvas/graph";

const IdeaPanel = dynamic(() => import("../panels/IdeaPanel").then((x) => x.IdeaPanel), { loading: () => <Loading /> });
const TopicPanel = dynamic(() => import("../panels/IdeaPanel").then((x) => x.TopicPanel), { loading: () => <Loading /> });
const QueryPanel = dynamic(() => import("../panels/QueryPanel").then((x) => x.QueryPanel), { loading: () => <Loading /> });
const CorpusPanel = dynamic(() => import("../panels/CorpusPanel").then((x) => x.CorpusPanel), { loading: () => <Loading /> });
const TablePanel = dynamic(() => import("../panels/TablePanel").then((x) => x.TablePanel), { loading: () => <Loading /> });
const AppraisalPanel = dynamic(() => import("../panels/AppraisalPanel").then((x) => x.AppraisalPanel), { loading: () => <Loading /> });
const SynthesisPanel = dynamic(() => import("../panels/SynthesisPanel").then((x) => x.SynthesisPanel), { loading: () => <Loading /> });
const QuestionsPanel = dynamic(() => import("../panels/QuestionsPanel").then((x) => x.QuestionsPanel), { loading: () => <Loading /> });
const ExportView = dynamic(() => import("../panels/ExportPanel").then((x) => x.ExportView), { loading: () => <Loading /> });
const QuotePanel = dynamic(() => import("../panels/QuotePanel").then((x) => x.QuotePanel), { loading: () => <Loading /> });

function Body({ node }: { node: GNode }) {
  switch (node.kind) {
    case "idea": return <IdeaPanel />;
    case "topic": return <TopicPanel topicId={node.topicId!} />;
    case "query": return <QueryPanel topicId={node.topicId!} />;
    case "corpus": return <CorpusPanel />;
    case "table": return <TablePanel />;
    case "appraisal": return <AppraisalPanel />;
    case "synthesis": return <SynthesisPanel />;
    case "questions": return <QuestionsPanel />;
    case "export": return <ExportView />;
    case "quote": return <QuotePanel claimId={node.claimId!} />;
  }
}

/** Secondary commands for the panel's ⋯ menu. */
function useNodeMenu(node: GNode): MenuItem[] {
  const { projectId, refresh, run, confirmEdit, summary, states, claims } = useSession();
  const stage = node.kind === "table" ? (states["5"] === "approved" ? 6 : 5) : node.stages[0];
  const jobMenu = useJobMenu(stage);
  const post = (path: string) => async () => {
    await api(projectPath(projectId, path), { body: {} });
    await refresh();
  };
  switch (node.kind) {
    case "idea":
      return [
        ...(states["1"] === "approved" && summary && !summary.scoping.done ? [{ label: "Skip remaining questions", onSelect: post("scoping/skip") }] : []),
        ...(states["1"] === "approved" ? [{ label: "Restart the conversation", onSelect: async () => { if (await confirmEdit(2)) await post("scoping/restart")(); } }] : []),
        ...(summary?.topics.length ? [{ label: "Regenerate subtopics", onSelect: () => run({ type: "branch" }) }] : []),
        ...(states["1"] === "approved" ? [{ label: "Add a topic", onSelect: () => run({ type: "addTopic" }) }] : []),
      ];
    case "topic":
      return [
        { label: "Add a sibling topic", onSelect: () => run({ type: "addTopic" }), disabled: (summary?.topics.length ?? 0) >= 8 },
        { label: "Delete topic", danger: true, onSelect: () => run({ type: "dismissTopic", topicId: node.topicId! }) },
      ];
    case "query":
      return [
        { label: "Dry-run all queries", onSelect: post("search/dryrun-all") },
        { label: "Regenerate all queries", onSelect: () => run({ type: "buildQueries" }) },
      ];
    case "appraisal":
      return [
        ...jobMenu,
        { label: "Re-check all quotes", hint: "no AI cost", onSelect: post("appraisals/reverify") },
        { label: "Pin every quote to the canvas", onSelect: () => claims && canvasStore.getState().pinQuotes(projectId, claims.map((c) => c.id)), disabled: !claims },
      ];
    case "questions":
    case "export":
      return [
        ...(node.kind === "questions" ? jobMenu : []),
        ...(states["9"] === "approved" ? [{ label: "Edit the question again", onSelect: post("stages/9/reopen") }] : []),
      ];
    case "quote":
      return [{ label: "Unpin from the canvas", onSelect: () => { canvasStore.getState().unpinQuote(projectId, node.claimId!); canvasStore.getState().closePanel(); } }];
    default:
      return jobMenu;
  }
}

export function FocusPanel({ node, mobile }: { node: GNode; mobile: boolean }) {
  const { costs } = useSession();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const items = useNodeMenu(node);
  const cost = node.stages.map((s) => costs[String(s)]).filter(Boolean);
  const calls = cost.reduce((a, c) => a + c.calls, 0);
  const dollars = cost.reduce((a, c) => a + c.cost, 0);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [node.id]);

  function close() {
    canvasStore.getState().closePanel();
    requestAnimationFrame(() => (document.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`) as HTMLElement | null)?.focus());
  }

  return (
    <m.aside
      key={node.id}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
      role="region"
      aria-label={`${KIND_LABEL[node.kind]} panel`}
      data-panel={node.kind}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          const t = e.target as HTMLElement;
          if (t.closest("[role=dialog],[role=menu],[data-radix-popper-content-wrapper]")) return;
          e.stopPropagation();
          close();
        }
      }}
      className={cx("fixed bottom-0 right-0 z-30 flex flex-col border-l border-line bg-bg-1", mobile ? "top-0 w-full" : "top-12 w-[480px] xl:w-[560px]")}
    >
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-12 text-fg-2">
            <KindIcon kind={node.kind} /> {KIND_LABEL[node.kind]}
            {calls > 0 && <span className="tabular-nums" title="AI calls and cost for this step (mock calls cost nothing)">· AI {calls} call{calls === 1 ? "" : "s"} · ${dollars.toFixed(3)}</span>}
          </p>
          <h2 ref={headingRef} tabIndex={-1} className="mt-1 line-clamp-2 text-16 font-semibold text-fg-0">{node.title}</h2>
          <div className="mt-2"><NodeStatusBadge node={node} /></div>
        </div>
        <MoreMenu items={items} label={`More actions for ${KIND_LABEL[node.kind]}`} />
        <CloseButton onClick={close} label="Close panel (Esc)" />
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4" data-panel-body>
        <PanelFooterSlot.Provider value={slot}>
          <Body node={node} />
        </PanelFooterSlot.Provider>
      </div>
      <div ref={setSlot} data-panel-footer className="border-t border-line empty:hidden" />
    </m.aside>
  );
}
