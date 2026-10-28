"use client";
import type { ReactNode } from "react";
import { TransitionLink } from "../vt";
import { ArrowLeft } from "lucide-react";
import { ErrorState, Loading } from "../ui";
import { MotionRoot } from "../motion";
import { AppMenu } from "../AppMenu";
import { ActionButton } from "../panels/common";
import { SessionProvider, useSession } from "./SessionContext";
import { nextAction } from "@/lib/canvas/actions";

/** A full-screen view that belongs to one session node (table, export): back to the canvas, one mission. */
export function SessionPage({ projectId, node, title, children, showAction = true }: { projectId: string; node: string; title: string; children: ReactNode; showAction?: boolean }) {
  return (
    <MotionRoot>
      <SessionProvider
        projectId={projectId}
        fallback={(s) => (s ? <main id="main" className="mx-auto max-w-xl p-8"><ErrorState error={s.error} onRetry={s.retry} title="Could not open this session" /></main> : <main id="main" className="p-8"><Loading /></main>)}
      >
        <Frame node={node} title={title} showAction={showAction}>{children}</Frame>
      </SessionProvider>
    </MotionRoot>
  );
}

function Frame({ node, title, children, showAction }: { node: string; title: string; children: ReactNode; showAction: boolean }) {
  const { projectId, graph, input } = useSession();
  const n = graph.nodes.find((x) => x.id === node);
  const action = showAction && n ? nextAction(n, graph, input) : null;
  return (
    <div className="fixed inset-0 flex flex-col bg-bg-0">
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b border-line px-2 py-1 md:px-4">
        <TransitionLink href={`/s/${projectId}?node=${encodeURIComponent(node)}`} className="btn-ghost h-11">
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Canvas
        </TransitionLink>
        <h1 className="min-w-0 flex-1 truncate text-16 font-semibold">{title}</h1>
        {action && <ActionButton action={action} primary showReason />}
        <AppMenu />
      </header>
      <main id="main" className="min-h-0 flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
