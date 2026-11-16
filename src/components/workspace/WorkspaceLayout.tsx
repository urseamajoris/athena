"use client";
import type { ReactNode } from "react";
import { TopBar } from "../AppChrome";
import { StageHeader, StageRail, type StageRailProps } from "./StageRail";

/**
 * The review workspace: the top bar, the stage rail (left on wide screens, one line on phones) and the open
 * screen. The rail comes first in the page, so the Tab order is rail, content, action bar.
 */
export function WorkspaceLayout({ rail, children }: { rail: StageRailProps; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-bg-0">
      {/* On phones the one-line stage header is what stays in view, not the top bar. */}
      <TopBar stick="wide" />
      <div className="lg:grid lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="sticky top-[var(--topbar-h)] h-[calc(100dvh-var(--topbar-h))] overflow-y-auto border-r border-line bg-bg-1 max-lg:hidden short:static short:h-auto">
          <StageRail {...rail} />
        </aside>
        <div className="contents lg:hidden">
          <StageHeader {...rail} />
        </div>
        <main id="main" className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
