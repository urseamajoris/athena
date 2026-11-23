"use client";
import { Lock } from "lucide-react";
import { Spinner, cx } from "../ui";
import { cmdKey, useSessionActions } from "../session/SessionContext";
import type { Action } from "@/lib/canvas/actions";

/**
 * Renders a node action. `primary` makes it the view's one accent-filled button. A locked action stays
 * focusable (aria-disabled) so keyboard users can reach it and read why it is locked.
 */
export function ActionButton({ action, primary, size = "md", className, showReason = false }: { action: Action; primary?: boolean; size?: "sm" | "md"; className?: string; showReason?: boolean }) {
  const { run, busy } = useSessionActions();
  const locked = !!action.disabledReason;
  const isBusy = busy === cmdKey(action.cmd);
  return (
    <span className={cx("inline-flex flex-col gap-1", className)}>
      <button
        type="button"
        data-action={action.cmd.type}
        className={cx(primary ? "btn-primary" : "btn-secondary", size === "sm" && "btn-sm", "w-full")}
        aria-disabled={locked || !!busy || undefined}
        title={action.disabledReason}
        onClick={(e) => {
          e.stopPropagation();
          if (locked || busy) return;
          run(action.cmd);
        }}
      >
        {isBusy ? <Spinner className="h-4 w-4" /> : locked ? <Lock className="h-4 w-4" strokeWidth={1.5} aria-hidden /> : null}
        {action.label}
        {locked && <span className="sr-only"> (locked: {action.disabledReason})</span>}
      </button>
      {locked && showReason && <span className="text-12 text-fg-2">{action.disabledReason}</span>}
    </span>
  );
}

