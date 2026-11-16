"use client";
// The frame every screen of a review is drawn in, top to bottom:
//
//   eyebrow     "Stage 3 of 4 · Papers"
//   headline    the task, as the page title            (STEPS[step].headline)
//   lead        one sentence: what to do here          (STEPS[step].lead)
//   banner      at most one StateBanner                (automatic)
//   content     the screen's own content               (children)
//   action bar  sticky: a "what happens next" line and the ONE primary button (StepActions, from the content)
//
// The frame decides three things so that no screen has to: a locked screen shows what unlocks it instead of its
// content; a screen that is not the one that needs the user offers "Go to <that screen>" instead of its own
// actions; and the banner is picked from the session's state.
import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowRight, Lock } from "lucide-react";
import { Button, ButtonLink, EmptyState, cx } from "../ui";
import { MoreMenu, type MenuItem } from "../overlays";
import { focusWithRing } from "../focus";
import { useOptionalSession } from "../session/SessionContext";
import { cmdKey, unlockText, type Action } from "../session/actions";
import { STEP_BY_KEY, phaseLabel, stepStatus, type StepKey } from "@/lib/shared/flow";
import { StateBanner } from "./StateBanner";

/** Where StepActions draws: the frame's action bar, or nowhere when the frame is offering "Go to …" instead. */
const ActionSlot = createContext<HTMLElement | null>(null);

export interface StepFrameProps {
  /** Which screen this is. The eyebrow, headline and lead come from `STEPS` in src/lib/shared/flow.ts. */
  step: StepKey;
  /** The screen's content: `Section`s, and one `StepActions`. */
  children: ReactNode;
  /** `reading` (default): a text column. `wide`: for tables and side-by-side content. */
  width?: "reading" | "wide";
  /** Replace the headline or lead for this state of the screen (rare: the defaults are the contract). */
  headline?: string;
  lead?: ReactNode;
}

export function StepFrame({ step, children, width = "reading", headline, lead }: StepFrameProps) {
  const def = STEP_BY_KEY[step];
  const session = useOptionalSession();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const status = session ? stepStatus(def, session.states) : "review";
  const locked = status === "locked";
  const current = session ? STEP_BY_KEY[session.current] : def;
  const isCurrent = current.key === step;
  const column = cx("mx-auto w-full", width === "wide" ? "max-w-6xl" : "max-w-3xl");

  // Opening another screen starts at its top, with focus on its title (so the next Tab enters its content).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    focusWithRing(title.current);
  }, [step]);

  return (
    <div data-step={step} data-step-status={status} className="flex min-h-[calc(100dvh-var(--topbar-h))] flex-col max-lg:min-h-0">
      <div className="flex-1 px-4 pb-12 pt-6 md:px-10 lg:pt-10">
        <div className={column}>
          <header>
            {/* On phones the stage header above already says this. */}
            <p className="eyebrow max-lg:hidden">{phaseLabel(step)}</p>
            <h1 ref={title} tabIndex={-1} className="text-headline font-semibold lg:mt-1">{headline ?? def.headline}</h1>
            <p className="mt-2 max-w-2xl text-fg-1">{lead ?? def.lead}</p>
          </header>
          {session && !locked && <div className="mt-6 empty:hidden"><StateBanner step={step} /></div>}
          <div className="mt-8 space-y-10">
            {locked && session ? (
              <EmptyState icon={<Lock className="h-6 w-6" strokeWidth={2} />} title={`${unlockText(def, session.states) ?? "Finish the earlier screens first"}`}>
                This screen opens when the screens before it are done.
              </EmptyState>
            ) : (
              <ActionSlot.Provider value={isCurrent ? slot : null}>{children}</ActionSlot.Provider>
            )}
          </div>
        </div>
      </div>
      {/* Hidden while it holds nothing (a screen that is working has no button to offer). */}
      <div data-action-bar className="sticky bottom-0 z-30 border-t border-line bg-bg-1 px-4 py-3 md:px-10 short:static [&:not(:has([data-actions]))]:hidden">
        <div className={column}>
          <div ref={setSlot} className="contents" />
          {session && !isCurrent && (
            <ActionRow next={locked ? `${unlockText(def, session.states)}.` : status === "done" ? "This screen is done. You can still read it and change it." : `Finish ${current.title} first.`}>
              <Button variant="primary" onClick={() => session.goToStep(current.key)}>Go to {current.title} <ArrowRight className="h-4 w-4" strokeWidth={2} aria-hidden /></Button>
            </ActionRow>
          )}
        </div>
      </div>
    </div>
  );
}

function ActionRow({ next, reason, children }: { next?: ReactNode; reason?: string; children: ReactNode }) {
  return (
    <div data-actions className="flex flex-col gap-x-6 gap-y-2 md:flex-row md:items-center md:justify-between">
      <p className="min-w-0 flex-1 text-small text-fg-1">
        {reason ? <span role="status" className="font-medium text-fg-0">{reason}</span> : next}
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2 max-md:flex-col max-md:items-stretch">{children}</div>
    </div>
  );
}

/** The screen's one primary button. Give `onClick`, or `href` (add `download` for a file), or `form` to submit a form by id. */
export interface PrimaryAction {
  /** Verb first, with the object and the count: "Run 8 searches". */
  label: string;
  onClick?: () => void;
  href?: string;
  download?: boolean;
  form?: string;
  busy?: boolean;
  /** Why it cannot be pressed yet. Shown in the bar in place of the "next" line; the button stays focusable. */
  disabledReason?: string;
  /** The button waits only for the user's input (an empty box): it stays filled and clickable, so a click can say what is missing. */
  awaitInput?: boolean;
  icon?: ReactNode;
}

export interface StepActionsProps {
  /** The session's next action for this screen (`useSession().actionFor(step)`): label, reason, next line and what it runs. */
  action?: Action | null;
  /** Or the primary button, spelled out. One per screen. */
  primary?: PrimaryAction;
  /** Plain buttons beside it, for other things the user may want now (keep to one or two). */
  secondary?: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean }[];
  /** Rare or destructive actions: they go in the "More" menu. */
  more?: MenuItem[];
  /** One short line: what happens next, and whether it uses credits. */
  next?: ReactNode;
  /** Extra controls placed before the primary button (rare). */
  children?: ReactNode;
}

/**
 * The screen's actions, drawn in the frame's sticky action bar. Render it once, anywhere inside a StepFrame.
 * It draws nothing while the frame is offering "Go to <current screen>" (this screen is not the one that needs
 * the user), so a screen never has to check that itself.
 */
export function StepActions({ action, primary, secondary = [], more = [], next, children }: StepActionsProps) {
  const slot = useContext(ActionSlot);
  const session = useOptionalSession();
  const hint = useId();
  if (!slot) return null;
  const p: PrimaryAction | undefined = primary ?? (action && session ? { label: action.label, onClick: () => session.run(action.cmd), busy: session.busy === cmdKey(action.cmd), disabledReason: action.disabledReason } : undefined);
  const waiting = !!session?.busy || !!session?.pending;
  const blocked = !!p && (!!p.disabledReason || (waiting && !p.busy));
  if (!p && !secondary.length && !more.length && !children) return null;
  return createPortal(
    <ActionRow next={next ?? action?.next} reason={p?.disabledReason}>
      <MoreMenu items={more} />
      {secondary.map((b) => <Button key={b.label} onClick={b.onClick} busy={b.busy} aria-disabled={b.disabled || waiting || undefined}>{b.label}</Button>)}
      {children}
      {p && (p.href ? (
        <ButtonLink variant="primary" href={p.href} download={p.download || undefined} icon={p.icon} data-primary-action>{p.label}</ButtonLink>
      ) : (
        <Button
          variant="primary"
          type={p.form ? "submit" : "button"}
          form={p.form}
          busy={p.busy}
          icon={p.icon}
          aria-disabled={blocked || undefined}
          aria-describedby={p.disabledReason ? hint : undefined}
          awaitInput={p.awaitInput}
          data-primary-action
          onClick={p.onClick}
        >
          {p.label}
          {p.disabledReason && <span id={hint} className="sr-only"> ({p.disabledReason})</span>}
        </Button>
      ))}
    </ActionRow>,
    slot,
  );
}

/** A titled part of a screen. The title is body size, semibold: there is one headline per screen, the frame's. */
export function Section({ title, description, aside, children }: { title: string; description?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 id={id} className="font-semibold text-fg-0">{title}</h2>
          {description && <p className="mt-0.5 text-small text-fg-1">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
