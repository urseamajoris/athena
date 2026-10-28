"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Lock, X } from "lucide-react";
import { RadioGroup, Switch } from "radix-ui";
import { useApi } from "./api";
import { Disclosure, ErrorState, Loading, cx } from "./ui";
import { applyThemePref, readThemePref, type ThemePref } from "@/lib/theme";

interface Status {
  production: boolean;
  paidCalls: { attempted: number; blocked: number };
  mockMode: boolean;
  mockAi: boolean;
  spendUsd: number;
  budgetUsd: number;
  keys: { xai: boolean; openalex: boolean; contactEmail: boolean };
  models: Record<string, { resolved: string; status: string; note: string }>;
  maxResultsPerQuery: number;
  simulatedFailures: string[];
}

/** Settings: confirm mock mode and spend first; everything else is collapsed. */
export function SettingsView() {
  const { data, error, isLoading, mutate } = useApi<Status>("/api/status");
  const { data: projects } = useApi<{ projects: unknown[] }>("/api/projects");
  const [theme, setTheme] = useState<ThemePref>("dark");
  useEffect(() => setTheme(readThemePref()), []);
  return (
    <div className="min-h-screen bg-bg-0">
      <header className="flex h-12 items-center gap-3 border-b border-line px-2 md:px-4">
        <Link href="/sessions" className="btn-ghost h-11"><ArrowLeft className="h-4 w-4" strokeWidth={1.5} aria-hidden /> Sessions</Link>
      </header>
      <main id="main" className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-20 font-semibold">Settings</h1>
        {isLoading && <Loading />}
        {error && <div className="mt-4"><ErrorState error={error} onRetry={() => mutate()} /></div>}
        {data && (
          <div className="mt-6 space-y-4">
            <section aria-labelledby="mock-title" className="rounded-md border border-line bg-bg-1 p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 id="mock-title" className="font-semibold">Mock mode</h2>
                  <p className="mt-1 text-fg-1">
                    {data.mockMode
                      ? "On. Recorded database responses and a deterministic mock model: nothing is spent."
                      : data.mockAi
                        ? "Mock model, live databases (OpenAlex is metered)."
                        : "Off. Live xAI and database calls cost money."}
                  </p>
                </div>
                <Switch.Root
                  checked={data.mockMode}
                  disabled={!data.production}
                  aria-labelledby="mock-title"
                  aria-describedby="mock-lock"
                  className="inline-flex h-11 w-14 shrink-0 items-center justify-center rounded-full"
                >
                  <span className={cx("relative inline-flex h-7 w-12 items-center rounded-full border border-line-control", data.mockMode ? "bg-bg-3" : "bg-bg-0")}>
                    <Switch.Thumb className="block h-5 w-5 translate-x-1 rounded-full bg-fg-0 transition-transform data-[state=checked]:translate-x-6" />
                  </span>
                </Switch.Root>
              </div>
              <p id="mock-lock" className="mt-3 flex items-start gap-2 text-12 text-fg-2">
                <Lock className="h-4 w-3 shrink-0" strokeWidth={2} aria-hidden />
                {data.production
                  ? "Production: mock mode follows the MOCK_MODE setting the server was started with."
                  : "Locked on outside production. Paid APIs only run when the server starts with ATHENA_ENV=production and MOCK_MODE=false."}
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-sm bg-bg-2 px-3 py-2">
                  <dt className="text-12 text-fg-2">AI spend recorded</dt>
                  <dd className="text-20 font-semibold tabular-nums">${data.spendUsd.toFixed(2)} <span className="text-12 font-normal text-fg-2">of ${data.budgetUsd.toFixed(2)} budget</span></dd>
                </div>
                <div className="rounded-sm bg-bg-2 px-3 py-2">
                  <dt className="text-12 text-fg-2">Paid API calls since start</dt>
                  <dd className="text-20 font-semibold tabular-nums">{data.paidCalls.attempted} <span className="text-12 font-normal text-fg-2">{data.paidCalls.blocked ? `${data.paidCalls.blocked} blocked` : "attempted"}</span></dd>
                </div>
              </dl>
            </section>

            <Disclosure title="Keys and models">
              <ul className="space-y-2">
                {([["xAI API key", data.keys.xai], ["OpenAlex API key", data.keys.openalex], ["Contact email (PubMed, Crossref, Unpaywall)", data.keys.contactEmail]] as const).map(([label, ok]) => (
                  <li key={label} className="flex items-center gap-2">
                    {ok ? <Check className="h-4 w-4 text-ok" strokeWidth={2} aria-hidden /> : <X className="h-4 w-4 text-fg-2" strokeWidth={2} aria-hidden />}
                    {label}: <span className="text-fg-1">{ok ? "set" : "not set"}{ok && data.mockMode ? " (unused in mock mode)" : ""}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-12 text-fg-2">Keys live in the server environment (.env) and are never sent to the browser.</p>
              <h3 className="label mt-4">Models</h3>
              <ul className="space-y-1">
                {Object.entries(data.models).map(([role, m]) => (
                  <li key={role}><span className="text-fg-2">{role}:</span> <span className="font-mono text-12">{m.resolved}</span> <span className="text-12 text-fg-2">· {m.note}</span></li>
                ))}
              </ul>
            </Disclosure>

            <Disclosure title="Theme" meta={theme === "system" ? "match the system" : theme}>
              <RadioGroup.Root value={theme} onValueChange={(v) => { setTheme(v as ThemePref); applyThemePref(v as ThemePref); }} aria-label="Theme" className="space-y-1">
                {(["dark", "light", "system"] as const).map((t) => (
                  <RadioGroup.Item key={t} value={t} className="flex min-h-11 w-full items-center gap-3 rounded-sm px-2 text-left hover:bg-bg-3">
                    <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-line-control">
                      <RadioGroup.Indicator className="h-2 w-2 rounded-full bg-fg-0" />
                    </span>
                    {t === "dark" ? "Dark (default)" : t === "light" ? "Light" : "Match the system"}
                  </RadioGroup.Item>
                ))}
              </RadioGroup.Root>
            </Disclosure>

            <Disclosure title="Data">
              <p className="text-fg-1">{projects ? `${projects.projects.length} session${projects.projects.length === 1 ? "" : "s"}` : "Sessions"} stored in the local SQLite database. Delete one from its ⋯ menu on <Link href="/sessions" className="link">Sessions</Link>.</p>
              <p className="mt-2 text-12 text-fg-2">Retrieval fetches up to {data.maxResultsPerQuery} records per query.{data.simulatedFailures.length ? ` Simulated failures: ${data.simulatedFailures.join(", ")}.` : ""} Canvas layout and pinned quotes are kept in this browser.</p>
            </Disclosure>
          </div>
        )}
      </main>
    </div>
  );
}
