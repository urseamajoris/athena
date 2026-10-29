"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { m } from "motion/react";
import { api, projectPath } from "../api";
import { CloseButton, Loading, cx } from "../ui";
import { MoreMenu, type MenuItem } from "../overlays";
import { canvasStore, useSession } from "../session/SessionContext";
import { PanelFooterSlot, useJobMenu } from "../panels/common";
import { KindIcon } from "./icons";
import { focusWithRing, usingKeyboard } from "./focus";
import { NodeStatusBadge } from "./node-bits";
import { KIND_LABEL, frontierNodeId, frontierStage, st, toStatus, type GNode } from "@/lib/canvas/graph";
import { taskFor } from "@/lib/canvas/tasks";
import { stageAction } from "@/lib/canvas/actions";
import { STAGES } from "@/lib/shared/stages";
import { ArrowRight } from "lucide-react";

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

/** Whether a panel body portalled a footer (its own next action) into the slot. */
function useSlotUsed(slot: HTMLElement | null) {
  const [used, setUsed] = useState(true);
  useEffect(() => {
    if (!slot) return;
    const check = () => setUsed(slot.childElementCount > 0);
    check();
    const mo = new MutationObserver(check);
    mo.observe(slot, { childList: true });
    return () => mo.disconnect();
  }, [slot]);
  return used;
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
        { label: "Count matches for every search", onSelect: post("search/dryrun-all") },
        { label: "Rewrite all searches", onSelect: () => run({ type: "buildQueries" }) },
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

/**
 * When this panel has no next action of its own (its step is done, or waiting on an earlier one), its footer
 * still offers the way forward: go to the step that needs the user now.
 */
function WayForward({ node }: { node: GNode }) {
  const { graph, input, states } = useSession();
  const f = frontierStage(states);
  const target = frontierNodeId(graph, states);
  if (target === node.id) return null;
  const action = stageAction(f, input);
  const title = f ? `step ${f}: ${STAGES[f - 1].title.toLowerCase()}` : "your report";
  return (
    <div data-panel-footer-fallback className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
      <p className="text-12 text-fg-2">{f && f < (node.stages[0] ?? 0) ? `This step waits for ${title}.` : action ? `Next: ${action.label.toLowerCase()} (${title}).` : `Continue with ${title}.`}</p>
      <button className="btn-primary" onClick={() => canvasStore.getState().openPanel(target)}>
        Go to {f ? `step ${f}: ${STAGES[f - 1].title}` : "the report"} <ArrowRight className="h-4 w-4" strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}

export function FocusPanel({ node, mobile, top = 48 }: { node: GNode; mobile: boolean; top?: number }) {
  const { costs, input, states } = useSession();
  const task = taskFor(node, input);
  const viewing = task.step && task.step !== frontierStage(states);
  // A node can hold a later step's work (before any search exists, step 3 opens on the first topic): the
  // badge then shows that step's state, matching the "Step N of 9" beside it.
  const badgeNode = task.step && !node.stages.includes(task.step) ? { ...node, status: toStatus(st(states, task.step)) } : node;
  const showTitle = node.kind === "topic" || node.kind === "query" || node.kind === "quote" || (node.kind === "idea" && input.states["1"] === "approved");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const slotUsed = useSlotUsed(slot);
  const items0 = useNodeMenu(node);
  const cost = node.stages.map((s) => costs[String(s)]).filter(Boolean);
  const calls = cost.reduce((a, c) => a + c.calls, 0);
  const dollars = cost.reduce((a, c) => a + c.cost, 0);
  // AI use for this step is detail, not task: it lives at the bottom of the ⋯ menu.
  const items = calls > 0 ? [...items0, { label: `AI used here: ${calls} call${calls === 1 ? "" : "s"}, $${dollars.toFixed(3)}`, onSelect: () => {}, disabled: true }] : items0;

  useEffect(() => {
    focusWithRing(headingRef.current);
  }, [node.id]);

  // After an action the button that had focus often disappears or is disabled (Send answer, Keep topics,
  // Chosen), which drops focus to the page body. For keyboard users, put it back on the panel heading.
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    let owned = aside.contains(document.activeElement);
    const onFocusIn = (e: FocusEvent) => { owned = aside.contains(e.target as Node); };
    let frame = 0;
    const check = () => {
      frame = 0;
      const a = document.activeElement as HTMLElement | null;
      const lost = !a || a === document.body || !a.isConnected || (a as HTMLButtonElement).disabled === true;
      if (owned && lost && usingKeyboard()) focusWithRing(headingRef.current);
    };
    const mo = new MutationObserver(() => { frame ||= requestAnimationFrame(check); });
    mo.observe(aside, { subtree: true, childList: true, attributes: true, attributeFilter: ["disabled"] });
    document.addEventListener("focusin", onFocusIn);
    return () => {
      mo.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("focusin", onFocusIn);
    };
  }, []);

  /** Skip the step's content (an appraisal has dozens of controls) to its next action in the footer. */
  function skipToActions() {
    asideRef.current?.querySelector<HTMLElement>("[data-panel-footer] button, [data-panel-footer-fallback] button")?.focus();
  }

  function close() {
    canvasStore.getState().closePanel();
    requestAnimationFrame(() => (document.querySelector(`[data-node-id="${CSS.escape(node.id)}"]`) as HTMLElement | null)?.focus());
  }

  return (
    <m.aside
      ref={asideRef}
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
      style={mobile ? undefined : { top }}
      // On short viewports (200% zoom on a laptop) the whole panel scrolls: the header scrolls away with the
      // content and only the footer (the next action) stays pinned, without covering what has focus.
      className={cx("fixed bottom-0 right-0 z-30 flex flex-col border-l border-line bg-bg-1 short:overflow-y-auto short:scroll-pb-28", mobile ? "top-0 w-full" : "w-[480px] xl:w-[560px]")}
    >
      <header className="flex items-start gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-12 text-fg-1">
            <KindIcon kind={node.kind} />
            <span className="font-medium">{task.step ? `${viewing ? "Viewing step" : "Step"} ${task.step} of 9 · ${STAGES[task.step - 1].title}` : "Finished"}</span>
            <span aria-hidden className="text-fg-2">·</span>
            <NodeStatusBadge node={badgeNode} />
          </p>
          <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-20 font-semibold text-fg-0">{task.headline}</h2>
          {showTitle && node.title && <p className="mt-1 line-clamp-2 text-fg-1" title={node.title}>{node.kind === "idea" ? `“${node.title}”` : `${KIND_LABEL[node.kind]}: ${node.title}`}</p>}
          <p className="mt-2 text-fg-1">{task.help}</p>
          {task.next && <p className="mt-1 text-12 text-fg-2">{task.next}</p>}
          {mobile && (
            <div className="mt-2 flex gap-0.5" aria-hidden>
              {STAGES.map((s) => <span key={s.n} className={cx("h-1 flex-1 rounded-full", s.n === task.step ? "bg-fg-0" : states[String(s.n)] === "approved" ? "bg-ok" : states[String(s.n)] === "stale" ? "bg-warn" : "bg-bg-3")} />)}
            </div>
          )}
        </div>
        <MoreMenu items={items} label={`More actions for ${KIND_LABEL[node.kind]}`} />
        <CloseButton onClick={close} label="Close panel (Esc)" />
      </header>
      <button type="button" className="sr-only focus:not-sr-only focus:mx-4 focus:mt-2 focus:self-start focus:rounded-sm focus:bg-bg-2 focus:px-3 focus:py-2" onClick={skipToActions}>Skip to the next action</button>
      <div className="flex-1 overflow-y-auto px-4 py-4 short:flex-[1_0_auto] short:overflow-visible" data-panel-body>
        <PanelFooterSlot.Provider value={slot}>
          <Body node={node} />
        </PanelFooterSlot.Provider>
      </div>
      <div ref={setSlot} data-panel-footer className="border-t border-line bg-bg-1 empty:hidden short:sticky short:bottom-0" />
      {!slotUsed && <div className="border-t border-line bg-bg-1 short:sticky short:bottom-0"><WayForward node={node} /></div>}
    </m.aside>
  );
}
