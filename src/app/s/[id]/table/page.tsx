import { redirect } from "next/navigation";

/** The table has no page of its own: it is the "Choose papers" screen of the review. */
export default async function TableRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/s/${encodeURIComponent(id)}?step=choose`);
}
