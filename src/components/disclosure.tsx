"use client";
import type { ReactNode } from "react";
import { Collapsible } from "radix-ui";
import { ChevronRight } from "lucide-react";

/** A secondary section that starts collapsed (progressive disclosure). */
export function Disclosure({ title, children, defaultOpen = false, meta }: { title: ReactNode; children: ReactNode; defaultOpen?: boolean; meta?: ReactNode }) {
  return (
    <Collapsible.Root defaultOpen={defaultOpen} data-collapsible="" className="group/disc rounded-md border border-line">
      <Collapsible.Trigger className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 py-2 text-left text-fg-1 hover:text-fg-0">
        <ChevronRight className="h-4 w-4 shrink-0 transition-transform group-data-[state=open]/disc:rotate-90" strokeWidth={1.5} aria-hidden />
        <span className="min-w-0 flex-1 font-medium">{title}</span>
        {meta && <span className="text-12 text-fg-2">{meta}</span>}
      </Collapsible.Trigger>
      <Collapsible.Content className="border-t border-line px-3 py-3">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}

