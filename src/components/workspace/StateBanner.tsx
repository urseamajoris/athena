"use client";
import { AlertTriangle, Coins, Loader2, PauseCircle, XCircle } from "lucide-react";
import { ApiError } from "../api";
import { Button, ButtonLink, Notice, ProgressBar } from "../ui";
import { useSession } from "../session/SessionContext";
import { cmdKey, type Cmd } from "../session/actions";
import { STEP_BY_KEY, type StepKey } from "@/lib/shared/flow";
import { pickBanner } from "./banner";

const ICON = { className: "h-5 w-5", strokeWidth: 2 } as const;

/**
 * The state of a screen, in plain words, with its one action. At most one shows at a time, directly under the
 * headline (StepFrame puts it there; a screen never renders its own):
 *
 *   working          live progress; "You can close this page; it keeps running."         Stop
 *   stopped          what went wrong                                                      Try again
 *   out of date      why                                                                  Bring up to date / Keep as is
 *   out of credits   "Your work is saved."                                                Buy credits
 *   AI not set up    an administrator needs to add an API key                             (nothing the user can do)
 *   AI paused        by the administrator                                                 (nothing the user can do)
 *   budget reached   the server's AI budget                                               (nothing the user can do)
 */
export function StateBanner({ step }: { step: StepKey }) {
  const s = useSession();
  const def = STEP_BY_KEY[step];
  const err = s.error;
  const b = pickBanner({
    step: def,
    states: s.states,
    staleReasons: s.staleReasons,
    jobs: s.jobs,
    ai: s.ai,
    credits: s.credits,
    pending: s.pending,
    actionError: err ? { message: err.error instanceof Error ? err.error.message : String(err.error), kind: err.error instanceof ApiError ? err.error.kind : undefined } : null,
  });
  if (!b) return null;
  const act = (cmd: Cmd, label: string) => (
    <Button busy={s.busy === cmdKey(cmd)} aria-disabled={(!!s.busy && s.busy !== cmdKey(cmd)) || undefined} onClick={() => s.run(cmd)}>{label}</Button>
  );
  switch (b.kind) {
    case "working":
      return (
        <Notice tone="run" icon={<Loader2 {...ICON} className="h-5 w-5 motion-safe:animate-spin" />} title={b.title} action={b.stage ? act({ type: "cancel", stage: b.stage }, "Stop") : undefined}>
          {b.total ? (
            <div className="mt-2 max-w-md">
              <ProgressBar value={b.done ?? 0} max={b.total} label={`${def.title} progress`} />
              <p className="mt-1 text-small"><span className="tabular-nums">{b.done ?? 0} of {b.total}</span> done. You can close this page; it keeps running.</p>
            </div>
          ) : (
            <p>This can take a minute. You can close this page; it keeps running.</p>
          )}
        </Notice>
      );
    case "credits":
      return (
        <Notice tone="warn" icon={<Coins {...ICON} />} title="You are out of credits" action={<ButtonLink href="/credits">Buy credits</ButtonLink>}>
          Your work is saved. AI steps continue when you have credits.
        </Notice>
      );
    case "ai-not-set-up":
      return (
        <Notice tone="warn" icon={<PauseCircle {...ICON} />} title="AI is not set up yet">
          An administrator needs to add an API key. Your work is saved, and this screen continues once a key is added.
        </Notice>
      );
    case "ai-paused":
      return (
        <Notice tone="warn" icon={<PauseCircle {...ICON} />} title="AI is paused by the administrator">
          Your work is saved. This screen continues when AI is switched back on.
        </Notice>
      );
    case "budget":
      return (
        <Notice tone="warn" icon={<PauseCircle {...ICON} />} title="The server’s AI budget is used up">
          Your work is saved. An administrator needs to raise the budget before AI steps can continue.
        </Notice>
      );
    case "failed":
      return (
        <Notice
          tone="err"
          icon={<XCircle {...ICON} />}
          title={b.fromAction ? "That did not work" : "This step stopped"}
          action={b.stage ? act({ type: "run", stage: b.stage }, "Try again") : err?.cmd ? act(err.cmd, "Try again") : undefined}
        >
          <span className="whitespace-pre-wrap break-words">{b.message}</span> Your work is saved.
        </Notice>
      );
    case "stale":
      return (
        <Notice
          tone="warn"
          icon={<AlertTriangle {...ICON} />}
          title="Out of date"
          action={
            b.blocker ? (
              <Button onClick={() => s.goToStep(b.blocker!.key)}>Go to {b.blocker.title}</Button>
            ) : (
              <>
                {act({ type: "bringUpToDate", stage: b.stage }, "Bring up to date")}
                {act({ type: "keep", stage: b.stage }, "Keep as is")}
              </>
            )
          }
        >
          {b.reason ? `${b.reason.replace(/[.\s]+$/, "")} after this was made.` : "An earlier answer changed after this was made."}{" "}
          {b.blocker ? `Finish ${b.blocker.title} first, then decide what to do here.` : "You can still read it. Nothing changes until you choose."}
        </Notice>
      );
  }
}
