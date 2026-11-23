import { redirect } from "next/navigation";
import { STAGES } from "@/lib/shared/stages";

/** The old wizard URL (/projects/[id]?stage=N) opens the canvas with that stage's node. */
export default async function OldProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string }> }) {
  const { id } = await params;
  const { stage } = await searchParams;
  const s = STAGES.find((x) => String(x.n) === stage);
  redirect(s ? `/s/${encodeURIComponent(id)}?node=${s.key}` : `/s/${encodeURIComponent(id)}`);
}
