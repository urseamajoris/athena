import { redirect } from "next/navigation";
import { stepForStage } from "@/lib/shared/flow";

/** An old link (/projects/[id]?stage=N) opens the review on the screen that holds that stage. */
export default async function OldProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ stage?: string }> }) {
  const { id } = await params;
  const { stage } = await searchParams;
  const n = Number(stage);
  redirect(Number.isInteger(n) && n >= 1 && n <= 9 ? `/s/${encodeURIComponent(id)}?step=${stepForStage(n).key}` : `/s/${encodeURIComponent(id)}`);
}
