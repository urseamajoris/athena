"use client";
import { ArrowRight } from "lucide-react";
import { canvasStore, useCanvas, useSession } from "../session/SessionContext";
import { cx } from "../ui";
import { ActionButton } from "../panels/action-button";
import { frontierNodeId } from "@/lib/canvas/graph";
import { nextAction } from "@/lib/canvas/actions";
import { taskFor } from "@/lib/canvas/tasks";

/**
 * "Your next step": the task that needs the user now, with the view's one primary button. A step that asks the
 * user to check something opens first (the check happens in its panel, whose footer then offers the run action).
 */
export function NextStepBar({ floating = false }: { floating?: boolean }) {
  const { graph, input, states } = useSession();
  const panel = useCanvas((s) => s.panel);
  const id = frontierNodeId(graph, states);
  const node = graph.nodes.find((n) => n.id === id);
  if (!node || panel) return null;
  const next = nextAction(node, graph, input);
  const task = taskFor(node, input);
  // Step 1 needs no separate check: the idea is on the card, so the bar offers the same action as the card.
  const check = node.status === "review" && node.kind !== "idea";
  if (!next && !check) return null;
  return (
    <section aria-label="Next step" className={cx(floating ? "pointer-events-auto rounded-md border border-line-strong bg-bg-1 shadow-lg" : "sticky top-0 z-10 border-b border-line bg-bg-0")}>
      <div className={cx("flex flex-wrap items-center gap-3 px-4 py-3", !floating && "mx-auto max-w-4xl")}>
        <p className="min-w-0 flex-1">
          <span className="block text-12 text-fg-2">{task.step ? `Your next step · step ${task.step} of 9` : "Your next step"}</span>
          <span className="block font-medium">{task.headline}</span>
        </p>
        {check ? (
          <button className="btn-primary" onClick={() => canvasStore.getState().openPanel(node.id)}>
              Open step {task.step ?? ""} <ArrowRight className="h-4 w-4" strokeWidth={1.5} aria-hidden />
            </button>
        ) : (
          next && <ActionButton action={next} primary showReason />
        )}
      </div>
    </section>
  );
}
