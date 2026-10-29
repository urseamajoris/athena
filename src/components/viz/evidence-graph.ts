// Layout for the evidence network: statements (known / contested / unknown) on one side, the papers whose
// quotes support them on the other, joined by the quotes. Shared by the 3D and 2D versions.
import { studyGroupOf } from "@/lib/shared/categories";

export interface EvStatement { id: string; kind: "known" | "contested" | "unknown"; text: string; paperIds: string[] }
export interface EvPaper { id: string; label: string; studyType: string | null }
export interface EvGraph {
  statements: (EvStatement & { x: number; y: number; z: number })[];
  papers: (EvPaper & { x: number; y: number; z: number; group: string })[];
  links: { s: number; p: number }[];
}

const KIND_Y = { known: 1, contested: 0, unknown: -1 } as const;

export function layoutEvidence(statements: EvStatement[], papers: EvPaper[]): EvGraph {
  const kinds = ["known", "contested", "unknown"] as const;
  const st = kinds.flatMap((k) => {
    const list = statements.filter((s) => s.kind === k);
    return list.map((s, i) => ({ ...s, x: -3, y: KIND_Y[k] * 2.2 + (i - (list.length - 1) / 2) * 0.45, z: (i % 2 ? 0.4 : -0.4) }));
  });
  const used = papers.filter((p) => statements.some((s) => s.paperIds.includes(p.id)));
  const pp = used.map((p, i) => ({ ...p, group: studyGroupOf(p.studyType), x: 3, y: (i - (used.length - 1) / 2) * 0.5, z: ((i * 7) % 5 - 2) * 0.3 }));
  const links: { s: number; p: number }[] = [];
  st.forEach((s, si) => s.paperIds.forEach((pid) => {
    const pi = pp.findIndex((p) => p.id === pid);
    if (pi >= 0) links.push({ s: si, p: pi });
  }));
  return { statements: st, papers: pp, links };
}
