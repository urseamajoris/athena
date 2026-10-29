"use client";
import { useMemo } from "react";
import { ChevronRight } from "lucide-react";
import { canvasStore, useCanvas, useSession } from "../session/SessionContext";
import { cx } from "../ui";
import { ActionButton } from "../panels/action-button";
import { NextStepBar } from "./NextStepBar";
import { KindIcon } from "./icons";
import { NodeStatusBadge, TrustBadges } from "./node-bits";
import { KIND_LABEL, frontierNodeId, type GNode, type Graph, type GraphInput } from "@/lib/canvas/graph";
import { nextAction } from "@/lib/canvas/actions";
import { taskFor } from "@/lib/canvas/tasks";

export interface TreeItem {
  node: GNode;
  children: TreeItem[];
}

/**
 * The graph as an indented tree. Each node hangs under its first parent, except the Corpus, which
 * merges every query and so sits under the Idea (its note says how many queries feed it).
 */
export function graphToTree(graph: Graph): TreeItem[] {
  const items = new Map<string, TreeItem>(graph.nodes.map((n) => [n.id, { node: n, children: [] }]));
  const roots: TreeItem[] = [];
  for (const n of graph.nodes) {
    const parent = n.kind === "corpus" ? "idea" : n.parents[0];
    const p = parent ? items.get(parent) : undefined;
    if (p && parent !== n.id) p.children.push(items.get(n.id)!);
    else roots.push(items.get(n.id)!);
  }
  return roots;
}

interface ItemCtx { graph: Graph; input: GraphInput; frontier: string; panel: string | null; selected: string | null; corpusFrom: number }

function ListItem({ it, depth, c }: { it: TreeItem; depth: number; c: ItemCtx }) {
  const n = it.node;
  const action = nextAction(n, c.graph, c.input);
  return (
    <li>
      <div
        data-list-node={n.id}
        data-status={n.ghost ? "ghost" : n.status}
        className={cx("flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line py-2 pr-4", c.selected === n.id && "bg-bg-2", n.id === c.frontier && "border-l-2 border-l-fg-1")}
        style={{ paddingLeft: 16 + Math.min(depth, 4) * 16 }}
      >
        <button
          className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-sm text-left"
          onClick={() => canvasStore.getState().openPanel(n.id)}
        >
          <span className={cx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-sm border bg-bg-1 text-fg-1", n.ghost ? "border-dashed border-line-control" : n.status === "stale" ? "border-warn" : n.status === "error" ? "border-err" : "border-line-strong")}>
            <KindIcon kind={n.kind} />
          </span>
          <span className="min-w-0 flex-1">
            <span className={cx("line-clamp-2 block font-medium", n.kind === "quote" && "italic")}>{n.title}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 text-12 text-fg-1">
              <span className="text-fg-2">{KIND_LABEL[n.kind]}</span>
              <span className="truncate tabular-nums">{n.key}{n.kind === "corpus" && c.corpusFrom > 1 ? ` · from ${c.corpusFrom} queries` : ""}</span>
            </span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-fg-2" strokeWidth={1.5} aria-hidden />
        </button>
        <span className="flex items-center gap-3">
          <NodeStatusBadge node={n} />
          <TrustBadges node={n} verbose />
        </span>
        {n.ghost ? (
          // Keep removes its own button: hand focus to the row, which stays.
          <span onClickCapture={(e) => { const row = e.currentTarget.closest("[data-list-node]")?.querySelector<HTMLElement>(":scope > button"); requestAnimationFrame(() => row?.focus()); }}>
            <ActionButton action={{ cmd: { type: "acceptTopic", topicId: n.topicId! }, label: "Keep" }} />
          </span>
        ) :action && n.id !== c.frontier ? (
          <ActionButton action={action} showReason />
        ) : null}
      </div>
      {it.children.length > 0 && (
        <ul aria-label={`Under ${KIND_LABEL[n.kind]}`}>
          {it.children.map((ch) => <ListItem key={ch.node.id} it={ch} depth={depth + 1} c={c} />)}
        </ul>
      )}
    </li>
  );
}

export function ListView() {
  const { graph, input, states } = useSession();
  const panel = useCanvas((s) => s.panel);
  const selected = useCanvas((s) => s.selected);
  const tree = useMemo(() => graphToTree(graph), [graph]);
  const c: ItemCtx = { graph, input, frontier: frontierNodeId(graph, states), panel, selected, corpusFrom: graph.nodes.find((n) => n.id === "corpus")?.parents.length ?? 0 };
  return (
    <div className="absolute inset-0 overflow-y-auto" data-list-view>
      <NextStepBar />
      <ul aria-label="Review as a list" className="mx-auto max-w-4xl pb-24">
        {tree.map((t) => <ListItem key={t.node.id} it={t} depth={0} c={c} />)}
      </ul>
    </div>
  );
}
