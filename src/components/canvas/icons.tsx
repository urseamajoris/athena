"use client";
import { BookOpenCheck, Download, FileSearch, Lightbulb, Library, ListTree, MessageSquareQuote, Network, Sigma, Table2, type LucideIcon } from "lucide-react";
import type { NodeKind } from "@/lib/canvas/graph";

export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  idea: Lightbulb,
  topic: Network,
  query: FileSearch,
  corpus: Library,
  table: Table2,
  appraisal: BookOpenCheck,
  synthesis: Sigma,
  questions: ListTree,
  export: Download,
  quote: MessageSquareQuote,
};

export function KindIcon({ kind, className = "h-4 w-4" }: { kind: NodeKind; className?: string }) {
  const I = KIND_ICON[kind];
  return <I className={className} strokeWidth={1.5} aria-hidden />;
}
