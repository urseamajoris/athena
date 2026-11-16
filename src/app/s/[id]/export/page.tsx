import { redirect } from "next/navigation";

/** The downloads have no page of their own: they are on the "Final question & report" screen of the review. */
export default async function ExportRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/s/${encodeURIComponent(id)}?step=report`);
}
