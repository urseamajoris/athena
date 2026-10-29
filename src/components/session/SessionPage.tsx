"use client";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TransitionLink } from "../vt";
import { ArrowLeft } from "lucide-react";
import { ErrorState, Loading } from "../ui";
import { AppMenu } from "../AppMenu";
import { ActionButton } from "../panels/common";
import { SessionProvider, useSession } from "./SessionContext";
import { nextAction } from "@/lib/canvas/actions";
import { StageRail } from "../canvas/StageRail";
import { DemoBanner } from "./DemoBanner";
import { AiPausedBanner } from "./AiPausedBanner";

/** A full-screen view that belongs to one session node (table, export): back to the canvas, one mission.
 *  Nothing here animates, so it does not load Motion. */
export function SessionPage({ projectId, node, title, children, showAction = true }: { projectId: string; node: string; title: string; children: ReactNode; showAction?: boolean }) {
  return (
    <SessionProvider
      projectId={projectId}
      fallback={(s) => (s ? <main id="main" className="mx-auto max-w-xl p-8"><ErrorState error={s.error} onRetry={s.retry} title="Could not open this session" /></main> : <main id="main" className="p-8"><Loading /></main>)}
    >
      <Frame node={node} title={title} showAction={showAction}>{children}</Frame>
    </SessionProvider>
  );
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
  const n = graph.nodes.find((x) => x.id === node);
  const action = showAction && n ? nextAction(n, graph, input) : null;
  return (
    <div className="fixed inset-0 flex flex-col bg-bg-0">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-line px-2 py-1 md:px-4">
        <TransitionLink href={back} prefetch={false} className="btn-ghost h-11" aria-label="Back to your review overview">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden /> <span>Overview</span>
        </TransitionLink>
        <h1 className="sr-only">{title}</h1>
        <div className="min-w-0 flex-1"><StageRail compact /></div>
        {action && <span className="max-md:hidden"><ActionButton action={action} primary showReason /></span>}
        <AppMenu />
      </header>
      <DemoBanner />
      <AiPausedBanner />
      <main id="main" className="min-h-0 flex-1 overflow-hidden">{children}</main>
      {action && <div className="shrink-0 border-t border-line bg-bg-1 px-4 py-2 md:hidden [&_button]:w-full"><ActionButton action={action} primary showReason /></div>}
    </div>
  );
}
