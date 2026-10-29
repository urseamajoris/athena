"use client";
import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { TransitionLink } from "../vt";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Loading } from "../ui";
import { AppMenu } from "../AppMenu";
import { ActionButton } from "../panels/common";
import { SessionUnavailable } from "./SessionUnavailable";
import { SessionProvider, useSession } from "./SessionContext";
import { nextAction } from "@/lib/canvas/actions";
import { frontierNodeId, frontierStage } from "@/lib/canvas/graph";
import { STAGES } from "@/lib/shared/stages";
import { StageRail } from "../canvas/StageRail";
import { focusWithRing } from "../canvas/focus";
import { AiPausedBanner } from "./AiPausedBanner";

/** Move focus to the page's one next action (in the header on wide screens, the bottom bar on narrow ones), for
 *  the "Skip to the next action" link of a page with many controls (the table). False if there is none. */
export function focusPageAction(): boolean {
  const el = [...document.querySelectorAll<HTMLElement>("[data-page-action] button, [data-page-action] a")].find((x) => x.offsetParent !== null);
  el?.focus();
  return !!el;
}

/** A full-screen view that belongs to one session node (table, export): back to the canvas, one mission.
 *  Nothing here animates, so it does not load Motion. */
export function SessionPage({ projectId, node, title, children, showAction = true }: { projectId: string; node: string; title: string; children: ReactNode; showAction?: boolean }) {
  return (
    <SessionProvider
      projectId={projectId}
      fallback={(s) => (s ? <SessionUnavailable error={s.error} retry={s.retry} /> : <main id="main" className="p-8"><Loading /></main>)}
    >
      <Frame node={node} title={title} showAction={showAction}>{children}</Frame>
    </SessionProvider>
  );
}

/** Focus the page's heading once it has rendered, so a keyboard user arriving from the canvas (or from the table
 *  at the report) does not start again from the page body. Never takes focus the user has already moved. */
function useFocusHeading(main: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const root = main.current;
    if (!root) return;
    const tryFocus = () => {
      const a = document.activeElement;
      if (a && a !== document.body && a.isConnected) return true;
      const h = root.querySelector<HTMLElement>("[data-page-heading], h1, h2");
      if (!h) return false;
      if (!h.hasAttribute("tabindex")) h.tabIndex = -1;
      focusWithRing(h);
      return true;
    };
    if (tryFocus()) return;
    // The page's data may still be loading: wait briefly for its heading.
    const mo = new MutationObserver(() => { if (tryFocus()) mo.disconnect(); });
    mo.observe(root, { childList: true, subtree: true });
    const t = setTimeout(() => mo.disconnect(), 5000);
    return () => { mo.disconnect(); clearTimeout(t); };
  }, [main]);
}

function Frame({ node, title, children, showAction }: { node: string; title: string; children: ReactNode; showAction: boolean }) {
  const { projectId, graph, input } = useSession();
  const back = `/s/${projectId}?node=${encodeURIComponent(node)}`;
  // The canvas is prefetched once this page has loaded, not while it hydrates.
  const router = useRouter();
  useEffect(() => {
    const t = setTimeout(() => router.prefetch(back), 3000);
    return () => clearTimeout(t);
  }, [router, back]);
  const mainRef = useRef<HTMLElement>(null);
  useFocusHeading(mainRef);
  const n = graph.nodes.find((x) => x.id === node);
  const action = showAction && n ? nextAction(n, graph, input) : null;
  // Where the review needs the user now. When that is no longer this page's step (the user pressed "Appraise
  // selected papers" here, and step 7 lives on the canvas), go there: its panel shows the running step's
  // progress. If the user came back later, the header still offers the way forward, so the page is no dead end.
  const target = frontierNodeId(graph, input.states);
  const f = frontierStage(input.states);
  const prevTarget = useRef(target);
  useEffect(() => {
    const was = prevTarget.current;
    prevTarget.current = target;
    if (showAction && was === node && target !== node) router.push(`/s/${projectId}?node=${encodeURIComponent(target)}`);
  }, [showAction, target, node, projectId, router]);
  const forward = showAction && !action && target !== node ? (
    <TransitionLink href={`/s/${projectId}?node=${encodeURIComponent(target)}`} prefetch={false} className="btn-primary">
      Go to {f ? `step ${f}: ${STAGES[f - 1].title}` : "the report"} <ArrowRight className="h-4 w-4" strokeWidth={1.5} aria-hidden />
    </TransitionLink>
  ) : null;
  return (
    <div className="fixed inset-0 flex flex-col bg-bg-0">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-line px-2 py-1 md:px-4">
        <TransitionLink href={back} prefetch={false} className="btn-ghost h-11" aria-label="Back to your review overview">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden /> <span>Overview</span>
        </TransitionLink>
        <h1 className="sr-only">{title}</h1>
        <div className="min-w-0 flex-1"><StageRail compact /></div>
        {action && <span className="max-md:hidden" data-page-action><ActionButton action={action} primary showReason /></span>}
        {forward && <span className="max-md:hidden" data-page-action>{forward}</span>}
        <AppMenu />
      </header>
      <AiPausedBanner />
      <main id="main" ref={mainRef} className="min-h-0 flex-1 overflow-hidden">{children}</main>
      {action && <div className="shrink-0 border-t border-line bg-bg-1 px-4 py-2 md:hidden [&_button]:w-full" data-page-action><ActionButton action={action} primary showReason /></div>}
      {forward && <div className="shrink-0 border-t border-line bg-bg-1 px-4 py-2 md:hidden [&_a]:w-full" data-page-action>{forward}</div>}
    </div>
  );
}
