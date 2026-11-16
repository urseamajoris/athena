import { PublicBar } from "@/components/AppChrome";
import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-bg-0">
      <PublicBar />
      <main id="main" className="mx-auto max-w-2xl px-4 py-16 md:px-6">
        <h1 className="text-headline font-semibold">This page does not exist</h1>
        <p className="mt-2 text-fg-1">The link may be wrong or out of date. Your reviews are safe.</p>
        <ButtonLink variant="primary" href="/sessions" className="mt-8">Go to my reviews</ButtonLink>
      </main>
    </div>
  );
}
