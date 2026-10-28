import { Suspense } from "react";
import { Wizard } from "@/components/wizard/Wizard";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <Wizard projectId={id} />
    </Suspense>
  );
}
