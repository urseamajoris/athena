"use client";
import {
  AlertCircle,
  BookOpenCheck,
  Cpu,
  Download,
  FileSearch,
  FileText,
  FolderOpen,
  Layers,
  Library,
  Lightbulb,
  ListTree,
  MessageSquareQuote,
  Network,
  Sigma,
  Table2,
  type LucideIcon,
} from "lucide-react";
import type { NodeKind } from "@/lib/canvas/graph";

export const KIND_ICON: Record<NodeKind, LucideIcon> = {
  ai_config: Cpu,
  idea: Lightbulb,
  topic: Network,
  query: FileSearch,
  query_item: FileText,
  corpus: Library,
  topic_corpus: FolderOpen,
  query_corpus: Layers,
  paper_group: AlertCircle,
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
