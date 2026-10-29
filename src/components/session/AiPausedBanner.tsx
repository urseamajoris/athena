"use client";
import { PauseCircle } from "lucide-react";
import { useSession } from "./SessionContext";

/** Shown on every session page while AI cannot run: says what still works and that nothing is lost. */
export function AiPausedBanner() {
  const { ai } = useSession();
  if (ai.enabled && !ai.budgetReached && !ai.keyMissing) return null;
  return (
    <div role="status" className="flex items-start gap-2 border-b border-warn-line bg-warn-soft px-4 py-2 text-fg-0">
      <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
      {/* No key comes first: switching AI on or raising the budget would not help until a key is added. */}
      {ai.keyMissing ? (
        <p>
          <strong className="font-semibold">AI is not set up yet.</strong> An administrator needs to add an xAI API key. Your work is saved; AI steps continue once a key is added.
        </p>
      ) : (
        <p>
          <strong className="font-semibold">{ai.budgetReached ? "AI budget reached." : "AI is paused by the administrator."}</strong> Your work is saved. You can still read, edit and approve, and searches still run; steps that need AI continue when it is back on.
        </p>
      )}
    </div>
  );
}
