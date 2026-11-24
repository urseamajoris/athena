"use client";
import Link from "next/link";
import { Coins, PauseCircle } from "lucide-react";
import { useSession } from "./SessionContext";
import { providerLabel } from "@/lib/shared/ai-providers";

/** Shown on every session page while AI cannot run or when a job is paused for insufficient credits. */
export function AiPausedBanner() {
  const { ai, jobs } = useSession();
  const creditPausedJob = Object.values(jobs).find(
    (j) => j && j.status === "paused" && typeof j.error === "string" && /credits/i.test(j.error),
  );
  const aiBlocked = !ai.enabled || ai.budgetReached || ai.keyMissing;
  if (!aiBlocked && !creditPausedJob) return null;
  const prov = ai.provider ? providerLabel(ai.provider) : "AI";
  return (
    <div role="status" className="flex flex-col divide-y divide-warn-line border-b border-warn-line bg-warn-soft text-fg-0">
      {creditPausedJob && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-start gap-2">
            <Coins className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
            <p>
              <strong className="font-semibold">More literature review credits needed.</strong> {creditPausedJob.error}
            </p>
          </div>
          <Link href="/credits" className="btn-primary min-h-9 shrink-0 px-3 py-1 text-13">
            Top up credits
          </Link>
        </div>
      )}
      {aiBlocked && (
        <div className="flex items-start gap-2 px-4 py-2">
          <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-warn" strokeWidth={2} aria-hidden />
          {/* No key comes first: switching AI on or raising the budget would not help until a key is added. */}
          {ai.keyMissing ? (
            <p>
              <strong className="font-semibold">AI is not set up yet.</strong> An administrator needs to add a {prov} API key (or switch provider). Your work is saved; AI steps continue once a key is added.
            </p>
          ) : (
            <p>
              <strong className="font-semibold">{ai.budgetReached ? "AI budget reached." : "AI is paused by the administrator."}</strong> Your work is saved. You can still read, edit and approve, and searches still run; steps that need AI continue when it is back on.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
