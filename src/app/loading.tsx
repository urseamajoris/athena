import { Loading } from "@/components/ui";

/** Shown while a page's data loads on the server. */
export default function PageLoading() {
  return (
    <main id="main" className="mx-auto max-w-4xl px-4 py-16 md:px-6">
      <Loading />
    </main>
  );
}
