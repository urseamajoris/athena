"use client";
// The stage rail: the four stages, each listing its screens with a status in words and an icon. It is the only
// progress indicator in the workspace. On wide screens it is the left column; on phones it folds into one line
// ("Stage 3 of 4 · Papers · Choose papers") that opens the full list.
import { useState } from "react";
import Link from "next/link";
import { Collapsible } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { StepStatusIcon, cx } from "../ui";
import { unlockText } from "../session/actions";
import { PHASES, STEPS, STEP_BY_KEY, STEP_STATUS_LABEL, currentStep, phaseLabel, stepStatus, stepsOfPhase, type StepKey } from "@/lib/shared/flow";
import type { StageState } from "@/lib/shared/stages";

export interface StageListProps {
  /** Engine stage states ("1".."9"). `{}` = a review that does not exist yet. */
  states: Record<string, StageState | undefined>;
  /** The screen that is open: marked "you are here". */
  open: StepKey;
  /** Where a screen's row leads. Leave out for a list that only shows the journey (the new-review page). */
  hrefFor?: (step: StepKey) => string;
  /** Called when a row is followed (the phone header closes itself). */
  onNavigate?: () => void;
}

/** The four stages and their screens. */
export function StageList({ states, open, hrefFor, onNavigate }: StageListProps) {
  const firstLocked = STEPS.find((s) => stepStatus(s, states) === "locked")?.key;
  return (
    <ol className="space-y-5">
      {PHASES.map((ph) => (
        <li key={ph.key}>
          <div className="flex items-start gap-3 px-3">
            <span aria-hidden className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line-control text-small font-semibold tabular-nums text-fg-1">{ph.n}</span>
            <p className="min-w-0">
              <span className="sr-only">Stage {ph.n}: </span>
              <span className="block font-semibold text-fg-0">{ph.title}</span>
              <span className="block text-small text-fg-2">{ph.blurb}</span>
            </p>
          </div>
          <ul className="mt-2 space-y-0.5">
            {stepsOfPhase(ph.key).map((s) => {
              const status = stepStatus(s, states);
              const here = s.key === open;
              // Only the first locked screen says what unlocks it: the ones after it wait for the same thing.
              const why = status === "locked" ? unlockText(s, states) : null;
              const body = (
                <>
                  <StepStatusIcon status={status} className="mt-1 h-4 w-4" />
                  <span className="min-w-0 flex-1">
                    <span className={cx("block", here ? "font-semibold text-fg-0" : status === "locked" ? "text-fg-2" : "font-medium text-fg-0")}>{s.title}</span>
                    <span className={cx("block text-small", status === "review" ? "font-medium text-fg-0" : "text-fg-2")}>
                      {STEP_STATUS_LABEL[status]}
                      {why && s.key === firstLocked ? `: ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ""}
                    </span>
                  </span>
                </>
              );
              const cls = cx("flex min-h-12 items-start gap-3 rounded-sm border-l-[3px] py-2 pl-[13px] pr-3", here ? "border-accent bg-accent-soft" : "border-transparent");
              return (
                <li key={s.key}>
                  {hrefFor ? (
                    <Link href={hrefFor(s.key)} aria-current={here ? "step" : undefined} title={why ?? undefined} onClick={onNavigate} data-rail-step={s.key} data-status={status} className={cx(cls, !here && "hover:bg-bg-3")}>
                      {body}
                    </Link>
                  ) : (
                    <div aria-current={here ? "step" : undefined} data-rail-step={s.key} data-status={status} className={cls}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** Where a row leads inside a review: the screen that needs the user has no ?step (the page follows it). */
export const stepHref = (projectId: string, states: Record<string, StageState | undefined>) => (step: StepKey) => (step === currentStep(states).key ? `/s/${projectId}` : `/s/${projectId}?step=${step}`);

export interface StageRailProps extends StageListProps {
  /** Which review this is: its research question, or its idea until there is one. */
  name?: string;
}

/** The rail as the left column (wide screens). */
export function StageRail({ name, ...list }: StageRailProps) {
  return (
    <nav aria-label="Stages of this review" className="flex flex-col gap-6 px-3 py-6">
      {name && (
        <div className="px-3">
          <p className="eyebrow">This review</p>
          <p className="mt-1 line-clamp-3 text-small text-fg-0" title={name}>{name}</p>
        </div>
      )}
      <StageList {...list} />
    </nav>
  );
}

/** The rail folded into one line (phones): where you are, and a button that opens the full list. */
export function StageHeader(list: StageListProps) {
  const [isOpen, setOpen] = useState(false);
  const def = STEP_BY_KEY[list.open];
  return (
    <Collapsible.Root open={isOpen} onOpenChange={setOpen} className="sticky top-0 z-30 border-b border-line bg-bg-1 short:static">
      <nav aria-label="Stages of this review">
        <Collapsible.Trigger className="flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left">
          <span className="min-w-0 flex-1 text-small">
            <span className="text-fg-2">{phaseLabel(list.open)} · </span>
            <span className="font-semibold text-fg-0">{def.title}</span>
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-small font-medium text-fg-1">
            {isOpen ? "Hide steps" : "All steps"}
            <ChevronDown className={cx("h-4 w-4 transition-transform", isOpen && "rotate-180")} strokeWidth={2} aria-hidden />
          </span>
        </Collapsible.Trigger>
        <Collapsible.Content className="max-h-[70dvh] overflow-y-auto border-t border-line px-1 py-4">
          <StageList {...list} onNavigate={() => setOpen(false)} />
        </Collapsible.Content>
      </nav>
    </Collapsible.Root>
  );
}
