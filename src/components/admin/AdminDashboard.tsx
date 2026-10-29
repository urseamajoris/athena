"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, KeyRound, Power, XCircle } from "lucide-react";
import { api, useApi } from "../api";
import { ErrorState, Loading, Spinner, cx } from "../ui";
import { Modal } from "../overlays";
import { Disclosure } from "../disclosure";
import { AppMenu } from "../AppMenu";
import { LogoMark } from "../Logo";
import { BudgetBar, DailyBars, HBars, Stat } from "./charts";
import { UsersTable } from "./UsersTable";
import { STUDY_GROUPS, slotVar } from "@/lib/shared/categories";
import { relTime } from "@/lib/shared/format";
import { FORECAST_MIN_DAYS, FULL_TEXT_SOURCES, SOURCE_LABEL, topRows } from "@/lib/admin/metrics";
import type { AdminOverview } from "@/lib/admin/overview";

const usd = (v: number, d = 2) => `$${v.toFixed(d)}`;
const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.01 ? 1 : 0)}%`;
const ms = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`);
const mb = (b: number | null) => (b === null ? "unknown" : b > 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);
const num = (v: number) => v.toLocaleString();
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
const dur = (s: number) => (s >= 86400 ? `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h` : s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min`);

const LEVEL = {
  green: { Icon: CheckCircle2, text: "text-ok", border: "border-ok-line", bg: "bg-ok-soft", head: "Everything is healthy" },
  amber: { Icon: AlertTriangle, text: "text-warn", border: "border-warn-line", bg: "bg-warn-soft", head: "Needs your attention" },
  red: { Icon: XCircle, text: "text-err", border: "border-err-line", bg: "bg-err-soft", head: "Something is wrong" },
} as const;

function Section({ id, title, children, intro }: { id: string; title: string; children: React.ReactNode; intro?: string }) {
  return (
    <section aria-labelledby={id} className="rounded-md border border-line bg-bg-1 p-4">
      <h2 id={id} className="font-semibold">{title}</h2>
      {intro && <p className="mt-1 text-12 text-fg-2">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function AdminDashboard() {
  const { data, error, mutate, isValidating } = useApi<AdminOverview>("/api/admin/overview", { refreshInterval: 10_000 });
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 5000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="min-h-screen bg-bg-0">
      <header className="flex h-12 items-center justify-between gap-3 border-b border-line px-2 md:px-4">
        <div className="flex items-center gap-2">
          <Link href="/sessions" className="inline-flex h-11 items-center gap-2 rounded-sm px-1 font-semibold" aria-label="Athena: my projects"><LogoMark /><span className="max-sm:sr-only">Athena</span></Link>
          <span className="text-fg-2">/</span>
          <span className="font-medium">Admin</span>
        </div>
        <AppMenu />
      </header>
      <main id="main" className="mx-auto max-w-6xl space-y-4 px-4 py-6">
        {!data && !error && <Loading label="Reading the telemetry…" />}
        {error && <ErrorState error={error} onRetry={() => mutate()} title="Could not load the dashboard" />}
        {data && <Dashboard d={data} refresh={() => mutate()} validating={isValidating} />}
      </main>
    </div>
  );
}

function Dashboard({ d, refresh, validating }: { d: AdminOverview; refresh: () => void; validating: boolean }) {
  const L = LEVEL[d.verdict.level];
  const b = d.ai.budget;
  const t = d.ai.totals;
  // The three breakdowns cover the last 30 days; they add up to this (rows past the 9th are summed as "other").
  const recent = d.ai.byStage.reduce((a, r) => ({ calls: a.calls + r.calls, cost: a.cost + r.cost }), { calls: 0, cost: 0 });
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <h1 className="text-20 font-semibold">Is Athena healthy?</h1>
        <p className="text-12 text-fg-2" aria-live="off">
          {d.ai.key.inUse === "none" ? "AI not set up (no key) · " : !d.ai.enabled ? "AI switched off · " : "Live AI and databases · "}
          Updated <span suppressHydrationWarning>{relTime(d.generatedAt)}</span>, refreshes every 10 s {validating && <Spinner className="ml-1 h-3 w-3" label="Refreshing" />}
        </p>
      </div>

      {/* The answer, first: verdict and what needs attention. */}
      <section aria-labelledby="verdict" className={cx("rounded-md border px-4 py-3", L.border, L.bg)}>
        <h2 id="verdict" className={cx("flex items-center gap-2 text-16 font-semibold", L.text)}>
          <L.Icon className="h-5 w-5" strokeWidth={2} aria-hidden /> {d.verdict.level === "green" && d.verdict.worthALook ? "Healthy, with something worth a look" : L.head}
        </h2>
        <ul className="mt-2 space-y-1">
          {d.verdict.reasons.map((r) => {
            const R = LEVEL[r.level];
            // A green reason is a note (worth a look, not a fault): an info mark, not a tick.
            const Icon = r.level === "green" && d.verdict.worthALook ? Info : R.Icon;
            return <li key={r.text} className="flex items-start gap-2 text-fg-0"><Icon className={cx("mt-0.5 h-4 w-4 shrink-0", r.level === "green" && d.verdict.worthALook ? "text-fg-1" : R.text)} strokeWidth={2} aria-label={r.level === "green" ? "note" : r.level} />{r.text}</li>;
          })}
        </ul>
      </section>

      <AiKeyPanel d={d} refresh={refresh} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="Users" value={num(d.users.total)} sub={`incl. ${d.users.admins} admin${d.users.admins === 1 ? "" : "s"} · ${d.users.active24h} active today · ${d.users.active7d} this week`} />
        <Stat label="Projects" value={num(d.users.projects)} sub={`${d.users.finished} finished all nine steps${d.users.reopened ? ` · ${d.users.reopened} went back to an earlier step` : ""}`} />
        {/* One vocabulary on every tile: "errors" (no reply), "invalid reply, retried" (sent back once and fixed or
            not), "still invalid after the retry" (the step failed). A retried invalid reply is not an error. */}
        <Stat label="AI calls" value={num(t.sent)} sub={`sent to the model · errors: ${num(t.errors)} · invalid reply, retried: ${num(t.invalidRetried)} (${pct(t.invalidRetriedRate)})${t.invalidFinal ? ` · still invalid after the retry: ${num(t.invalidFinal)}` : ""}${t.blocked ? ` · ${num(t.blocked)} blocked, not sent` : ""}`} tone={t.errors + t.invalidFinal ? "warn" : undefined} />
        <Stat label="AI spend" value={usd(b.spentUsd)} sub={`of ${usd(b.limitUsd)} limit`} tone={b.pct >= 1 ? "err" : b.pct >= 0.8 ? "warn" : undefined} />
        <Stat label="Server errors (1 h)" value={pct(d.health.requests.errorRate)} sub={`${d.health.requests.errors5xx} of ${d.health.requests.lastHour} API requests${d.health.requests.lastHour < 20 ? " · too few to judge" : ""}`} tone={d.health.requests.errors5xx ? "warn" : undefined} />
        <Stat label="Browser errors (1 h)" value={num(d.health.clientErrors.lastHour)} sub="page errors in users' browsers" tone={d.health.clientErrors.lastHour ? "warn" : undefined} />
        <Stat label="Jobs now" value={`${d.health.jobs.running} running`} sub={`${d.health.jobs.queued} queued · ${d.health.jobs.paused} paused · ${d.health.jobs.stuck} stuck`} tone={d.health.jobs.stuck ? "warn" : undefined} />
      </div>

      <Section id="users-title" title="Users and progress" intro="Counts only. Research ideas, papers and notes are never shown on this dashboard. Account emails appear only in Accounts and the Audit log below.">
        <div className="grid gap-6 md:grid-cols-2">
          <DailyBars title="Sign-ups per day (14 days)" data={d.users.signupsByDay.map((x) => ({ day: x.day, value: x.value }))} />
          <HBars title="Projects per user" rows={d.users.projectsPerUser.map((x) => ({ key: x.bucket, label: `${x.bucket} project${x.bucket === "1" ? "" : "s"}`, value: x.users }))} format={(v) => `${v} user${v === 1 ? "" : "s"}`} />
          {/* One colour: the bars are counts of one thing. "Reached" never drops when a user goes back to edit. */}
          <HBars
            title="Funnel: projects that reached each step at least once"
            rows={d.users.funnel.map((f) => ({ key: String(f.stage), label: `${f.stage}. ${f.title}`, value: f.reached, sub: `· ${f.approved} approved now${f.outOfDate ? ` · ${f.outOfDate} out of date` : ""}` }))}
            note={`${d.users.finished} of ${d.users.projects} project${d.users.projects === 1 ? "" : "s"} finished all nine steps at least once${d.users.finished > d.users.finishedNow ? `; ${d.users.finished - d.users.finishedNow} of them went back to an earlier step since` : ""}. A step stays reached when an edit puts it out of date. Report downloads are not tracked.`}
          />
          {d.users.abandonment.some((a) => a.projects > 0) ? (
            <HBars title="Where people stop: the step unfinished projects are at now (no activity for 7 days)" rows={d.users.abandonment.map((a) => ({ key: String(a.stage), label: `${a.stage}. ${a.title}`, value: a.projects, color: "var(--cat-none)" }))} format={(v) => `${v} project${v === 1 ? "" : "s"}`} />
          ) : (
            <figure className="min-w-0">
              <figcaption className="text-12 font-medium text-fg-1">Where people stop</figcaption>
              <p className="mt-2 text-fg-2">No unfinished project has been idle for 7 days.</p>
            </figure>
          )}
        </div>
      </Section>

      <Section id="ai-title" title="AI usage" intro={`From the ai_calls log: every model call, its tokens and its cost. Every count here is calls sent to the model; attempts blocked because AI was off, no key was set or the budget was reached are never sent and are not counted (${num(d.ai.totals.blocked)} so far).`}>
        <div className="grid gap-6 md:grid-cols-2">
          <DailyBars title="AI spend per day (14 days)" data={d.ai.byDay} format={(v) => usd(v, 3)} />
          <DailyBars title="AI calls per day (14 days)" data={d.ai.callsByDay} />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Input tokens" value={num(d.ai.totals.tokens.input)} sub={`${num(d.ai.totals.tokens.cached)} cached`} />
          <Stat label="Output tokens" value={num(d.ai.totals.tokens.output)} sub={`${num(d.ai.totals.tokens.reasoning)} reasoning`} />
          {d.ai.latency.p50 === null ? (
            <Stat label="AI latency p50" value="None yet" sub="No live AI calls in the last 30 days." />
          ) : (
            <Stat label="AI latency p50" value={ms(d.ai.latency.p50)} sub={`p90 ${ms(d.ai.latency.p90)} · p99 ${ms(d.ai.latency.p99)}`} />
          )}
          <Stat label="Invalid reply, retried" value={num(t.invalidRetried)} sub={`${pct(t.invalidRetriedRate)} of calls · still invalid after the retry: ${num(t.invalidFinal)} · errors: ${num(t.errors)}`} />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          {([["Cost by step", d.ai.byStage], ["Cost by model", d.ai.byModel], ["Cost by prompt version", d.ai.byPrompt]] as const).map(([title, rows]) => (
            <HBars key={title} title={title} rows={topRows(rows, 9).map((r) => ({ key: r.key, label: r.key, value: r.cost, sub: `· ${plural(r.calls, "call")}` }))} format={(v) => usd(v, 3)} />
          ))}
        </div>
        <p className="mt-2 text-12 text-fg-2">
          Each breakdown covers the last 30 days and adds up to {plural(recent.calls, "call")} and {usd(recent.cost, 3)}; rows past the ninth are summed as “other”.
          {recent.calls !== t.sent && ` The ${num(t.sent)} calls in the tiles above are all time.`}
        </p>
      </Section>

      <Section id="sources-title" title="Data sources (last 24 h)" intro="Every request to the literature databases, including cache hits. Retries count as requests.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-12">
            <thead className="text-fg-2"><tr>{["Source", "Requests", "Live", "Cache hits", "Errors", "429s", "p50", "p95", ""].map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {d.sources.map((s) => (
                <tr key={s.source} className="border-t border-line">
                  <th scope="row" className="py-2 pr-3 font-medium text-fg-0">{SOURCE_LABEL[s.source] ?? s.source}{FULL_TEXT_SOURCES.has(s.source) && <span className="font-normal text-fg-2"> · full text</span>}</th>
                  <td className="tabular-nums">{s.requests}</td>
                  <td className="tabular-nums">{s.live}</td>
                  <td className="tabular-nums">{pct(s.cacheHitRate)}</td>
                  <td className={cx("tabular-nums", s.errorRate > (FULL_TEXT_SOURCES.has(s.source) ? 0.5 : 0.25) && s.requests >= 10 && "text-warn")}>{s.errors} ({pct(s.errorRate)})</td>
                  <td className="tabular-nums">{s.rateLimited}</td>
                  <td className="tabular-nums">{ms(s.p50)}</td>
                  <td className="tabular-nums">{ms(s.p95)}</td>
                  <td>{s.simulatedFailure ? <span className="text-warn">Simulated failure on</span> : s.simulated ? `${s.simulated} simulated` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-12 text-fg-2">
          Full-text sources (Unpaywall, Europe PMC, PDF downloads) are asked for every selected paper. Some failures are expected there: a paper that is not open access has no full text, and its appraisal then uses the abstract. The verdict flags them only when most requests fail.
        </p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section id="jobs-title" title="Background jobs (30 days)">
          <table className="w-full text-left text-12">
            <thead className="text-fg-2"><tr>{["Job", "Runs", "Done", "Failed", "Paused", "Typical time"].map((h) => <th key={h} className="py-1 pr-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {d.jobs.byKind.map((j) => (
                <tr key={j.kind} className="border-t border-line">
                  <th scope="row" className="py-2 pr-2 font-medium">{j.kind}</th>
                  <td className="tabular-nums">{j.runs}</td>
                  <td className="tabular-nums">{j.done}</td>
                  <td className={cx("tabular-nums", j.failed > 0 && "text-err")}>{j.failed}</td>
                  <td className="tabular-nums">{j.paused}</td>
                  <td className="tabular-nums">{j.p50Sec === null ? "–" : `${j.p50Sec.toFixed(0)} s (p95 ${j.p95Sec?.toFixed(0)} s)`}</td>
                </tr>
              ))}
              {!d.jobs.byKind.length && <tr><td colSpan={6} className="py-2 text-fg-2">No jobs yet.</td></tr>}
            </tbody>
          </table>
          <p className="mt-2 text-12 text-fg-2">{d.jobs.resumedAfterRestart} job run{d.jobs.resumedAfterRestart === 1 ? " was" : "s were"} resumed after a server restart.</p>
        </Section>
        <Section id="quality-title" title="Quality signals">
          <div className="space-y-6">
            <HBars
              title="Quotes checked against the source text"
              rows={[
                { key: "v", label: "Verified", value: d.quality.quotes.verified, color: NEUTRAL },
                { key: "u", label: "Unverified", value: d.quality.quotes.unverified, color: NEUTRAL, sub: `· ${d.quality.quotes.acceptedUnverified} accepted by users` },
              ]}
            />
            <HBars
              title="What appraisals were based on"
              rows={[
                { key: "f", label: "Full text", value: d.quality.appraisals.fullText, color: NEUTRAL },
                { key: "a", label: "Abstract only", value: d.quality.appraisals.abstractOnly, color: NEUTRAL },
              ]}
            />
            {/* Only this chart has category colours (study type), so a hue in this panel means one thing. */}
            <HBars title="Study types found (AI-derived from abstracts)" rows={d.quality.studyTypes.map((s) => { const c = STUDY_GROUPS.find((x) => x.key === s.key)!; return { key: s.key, label: s.label, value: s.n, color: slotVar(c.slot), shape: c.shape }; })} />
            <HBars title="Steps marked stale by an upstream edit (30 days)" rows={d.quality.staleByStage.filter((s) => s.stage > 1).map((s) => ({ key: String(s.stage), label: `${s.stage}. ${s.title}`, value: s.times, color: "var(--cat-none)" }))} format={(v) => `${v}×`} />
          </div>
        </Section>
      </div>

      <Section id="health-title" title="Server">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Stat label="Uptime" value={dur(d.health.instance.uptimeSec)} sub={d.health.instance.region ? `region ${d.health.instance.region}` : d.health.instance.node} />
          <Stat label="Memory (RSS)" value={mb(d.health.instance.memory.rss)} sub={`heap ${mb(d.health.instance.memory.heapUsed)} of ${mb(d.health.instance.memory.heapTotal)}`} />
          <Stat label="Database" value={d.health.database.ok ? mb(d.health.database.sizeBytes) : "Not answering"} sub={`${d.health.database.kind} · ${d.health.database.latencyMs} ms`} tone={d.health.database.ok ? undefined : "err"} />
          <Stat label="API latency (1 h)" value={ms(d.health.requests.p50Ms)} sub={`p95 ${ms(d.health.requests.p95Ms)}`} />
        </div>
        {d.health.instance.note && <p className="mt-2 text-12 text-fg-2">{d.health.instance.note}</p>}
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <DailyBars title="API requests per day" data={d.health.requests.byDay} />
          <DailyBars title="Server errors per day" data={d.health.requests.errorsByDay} />
        </div>
      </Section>

      <Section id="errors-title" title="Recent errors">
        {d.errors.requests.length + d.errors.jobs.length + d.errors.client.length === 0 ? (
          <p className="text-fg-2">No server errors, browser errors or failed jobs recorded.</p>
        ) : (
          <ul className="divide-y divide-line text-12">
            {[...d.errors.requests.map((e) => ({ at: e.at, what: `${e.method} ${e.route} → ${e.status}`, msg: e.error })), ...d.errors.jobs.map((j) => ({ at: j.at, what: `job ${j.kind} (step ${j.stage}) failed`, msg: j.error })), ...d.errors.client.map((c) => ({ at: c.at, what: `browser error on ${c.page}`, msg: c.message }))]
              .sort((a, b) => b.at.localeCompare(a.at))
              .slice(0, 20)
              .map((e, i) => (
                <li key={i} className="py-2"><span className="text-fg-2" suppressHydrationWarning>{relTime(e.at)}</span> · <span className="font-medium text-fg-0">{e.what}</span>{e.msg && <span className="block break-words text-fg-1">{e.msg}</span>}</li>
              ))}
          </ul>
        )}
      </Section>

      <Section id="people-title" title="Accounts" intro="Disable, reset a password, change a role or delete an account. Every action is logged below.">
        <UsersTable onChanged={refresh} />
      </Section>

      <Section id="audit-title" title="Audit log" intro={`Admin actions and security events. ${d.users.failedLogins24h} failed login${d.users.failedLogins24h === 1 ? "" : "s"} in the last 24 h.`}>
        <ul className="divide-y divide-line text-12">
          {d.audit.map((a) => (
            <li key={a.id} className="flex flex-wrap gap-x-2 py-2">
              <span className="text-fg-2" suppressHydrationWarning>{relTime(a.at)}</span>
              <span className={cx("rounded-sm border px-1", a.category === "admin" ? "border-run-line text-run" : "border-line-strong text-fg-1")}>{a.category}</span>
              <span className="font-medium text-fg-0">{a.action.replace(/_/g, " ")}</span>
              {a.actor && <span className="text-fg-1">by {a.actor}</span>}
              {a.target && a.target !== a.actor && <span className="text-fg-1">→ {a.target}</span>}
              {a.detail && Object.keys(a.detail).length > 0 && <span className="text-fg-2">{Object.entries(a.detail).map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`).join(" · ")}</span>}
            </li>
          ))}
        </ul>
      </Section>
    </>
  );
}

/** Bars for counts that are not a "Colour by" dimension: plain ink, so no category hue is reused here. */
const NEUTRAL = "var(--fg-2)";

function AiKeyPanel({ d, refresh }: { d: AdminOverview; refresh: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [keyInput, setKeyInput] = useState("");
  const [editKey, setEditKey] = useState(false);
  const [limit, setLimit] = useState("");
  const [confirmRaise, setConfirmRaise] = useState<string | null>(null);
  const k = d.ai.key;
  const b = d.ai.budget;
  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setErr(null);
    try {
      await fn();
      refresh();
      return true;
    } catch (e) {
      setErr((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const toggle = (enabled: boolean) => act("ai", () => api("/api/admin/ai", { body: { enabled } }));
  const saveLimit = async (confirmAboveEnv = false) => {
    const v = Number(limit);
    if (!Number.isFinite(v) || v < 0) return setErr("Enter a limit in dollars, for example 10.");
    try {
      setBusy("budget");
      setErr(null);
      await api("/api/admin/budget", { method: "PUT", body: { limitUsd: v, confirmAboveEnv } });
      setLimit("");
      setConfirmRaise(null);
      refresh();
    } catch (e) {
      const ae = e as Error & { kind?: string };
      if (ae.kind === "confirm_needed") setConfirmRaise(ae.message);
      else setErr(ae.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="aikey-title" className="rounded-md border border-line-strong bg-bg-1 p-4">
      <h2 id="aikey-title" className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4" strokeWidth={1.5} aria-hidden /> AI &amp; API key</h2>
      {b.pct >= 0.8 && (
        <p role="alert" className={cx("mt-3 rounded-sm border px-3 py-2", b.pct >= 1 ? "border-err-line bg-err-soft text-fg-0" : "border-warn-line bg-warn-soft text-fg-0")}>
          {b.pct >= 1 ? `The AI budget is used up (${usd(b.spentUsd)} of ${usd(b.limitUsd)}). AI steps are stopped and users see "AI budget reached".` : `AI spend has reached ${Math.round(b.pct * 100)}% of the limit (${usd(b.spentUsd)} of ${usd(b.limitUsd)}).`}
        </p>
      )}
      {err && <p role="alert" className="mt-3 rounded-sm border border-err-line px-3 py-2 text-err">{err}</p>}
      <div className="mb-4 mt-4 grid gap-6 lg:grid-cols-3">
        {/* 1. On/off */}
        <div>
          <h3 className="text-12 font-medium text-fg-2">AI for everyone</h3>
          <p className={cx("mt-1 flex items-center gap-2 text-16 font-semibold", d.ai.enabled ? "text-ok" : "text-warn")}>
            <Power className="h-4 w-4" strokeWidth={2} aria-hidden /> {d.ai.enabled ? "On" : "Off"}
          </p>
          <p className="mt-1 text-fg-1">{d.ai.enabled ? (k.inUse === "none" ? "Users can run AI steps once an xAI key is set." : "Users can run AI steps.") : "No model calls are made and nothing is spent. Users see “AI is paused by the administrator. Your work is saved.” Database searches still work."}</p>
          {d.ai.changedAt && <p className="mt-1 text-12 text-fg-2" suppressHydrationWarning>Changed {relTime(d.ai.changedAt)}{d.ai.changedBy ? ` by ${d.ai.changedBy}` : ""}</p>}
          <button className={cx("mt-3 min-h-11", d.ai.enabled ? "btn-secondary" : "btn-primary")} disabled={busy === "ai"} onClick={() => (d.ai.enabled ? setConfirmOff(true) : toggle(true))}>
            {busy === "ai" && <Spinner />} {d.ai.enabled ? "Turn AI off…" : "Turn AI back on"}
          </button>
        </div>

        {/* 2. Key */}
        <div>
          <h3 className="text-12 font-medium text-fg-2">xAI API key</h3>
          <p className="mt-1 text-16 font-semibold">{k.inUse === "none" ? "No key" : <>Key id <span className="font-mono">{k.keyId}</span></>}</p>
          {k.inUse !== "none" && <p className="mt-1 text-12 text-fg-2">The full key is never shown, and no part of it is: the key id is a fingerprint of the key, used to tell keys apart.</p>}
          <p className="mt-1 text-fg-1">
            {k.inUse === "admin" ? <>Set here{k.admin && <span suppressHydrationWarning> {relTime(k.admin.setAt)} by {k.admin.setBy ?? "an admin"}</span>}. It overrides the environment key.</> : k.inUse === "environment" ? "From the server environment (XAI_API_KEY)." : "Neither the environment nor this dashboard provides a key."}
          </p>
          {/* With no key, AI steps pause before any call: nothing is spent until a key is added. */}
          {k.inUse === "none" && <p className="mt-1 font-medium text-fg-0">AI is not set up: AI steps pause and nothing is spent until a key is added.</p>}
          {k.problem && <p className="mt-1 text-12 text-warn">{k.problem}</p>}
          {k.lastTest && (
            <p className={cx("mt-1 flex items-start gap-1 text-12", k.lastTest.ok ? "text-ok" : "text-fg-1")}>
              {k.lastTest.ok ? <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden /> : <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warn" aria-hidden />}
              <span>Last test <span suppressHydrationWarning>{relTime(k.lastTest.at)}</span>: {k.lastTest.message}</span>
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button className="btn-secondary min-h-11" disabled={!!busy || k.inUse === "none"} onClick={() => act("test", () => api("/api/admin/key/test", { body: {} }))}>{busy === "test" && <Spinner />}Test key</button>
            <button className="btn-secondary min-h-11" onClick={() => setEditKey(!editKey)} aria-expanded={editKey}>{k.admin ? "Replace key" : "Set a key"}</button>
            {k.admin && <button className="btn-ghost min-h-11" disabled={!!busy} onClick={() => act("clear", () => api("/api/admin/key", { method: "DELETE" }))}>Clear (use environment key)</button>}
          </div>
          {editKey && (
            <form
              className="mt-3 space-y-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (await act("key", () => api("/api/admin/key", { method: "PUT", body: { key: keyInput } }))) {
                  setKeyInput("");
                  setEditKey(false);
                }
              }}
            >
              <label className="label block">
                New xAI key
                <input className="input mt-1 w-full font-mono" type="password" autoComplete="off" spellCheck={false} value={keyInput} onChange={(e) => setKeyInput(e.target.value)} disabled={!k.encryption.ready} />
              </label>
              <p className="text-12 text-fg-2">{k.encryption.ready ? "Stored encrypted (AES-256-GCM). It is never shown again; the dashboard shows only its key id." : k.encryption.problem}</p>
              <button className="btn-primary min-h-11" disabled={!k.encryption.ready || keyInput.trim().length < 20 || busy === "key"}>{busy === "key" && <Spinner />}Save key</button>
            </form>
          )}
        </div>

        {/* 3. Budget */}
        <div>
          <h3 className="text-12 font-medium text-fg-2">Spend limit</h3>
          <p className="mt-1 text-16 font-semibold tabular-nums">{usd(b.spentUsd)} <span className="font-normal text-fg-2">of {usd(b.limitUsd)}</span></p>
          <div className="mt-2"><BudgetBar spent={b.spentUsd} limit={b.limitUsd} /></div>
          <p className="mt-2 text-12 text-fg-1">
            The limit is a total for all AI spend {b.since ? <>since the first AI call on {day(b.since)}</> : "on this database"}, not per day or month.{" "}
            {b.override ? `Set here (the server's limit is ${usd(b.envUsd)}).` : "The server's limit (XAI_BUDGET_USD)."}
          </p>
          <p className="mt-1 text-12 text-fg-1">
            {b.daysLeft === 0
              ? "The limit is reached."
              : !b.enoughHistory
                ? b.since ? `No forecast yet: spending started ${relTime(b.since)}, and a forecast needs ${FORECAST_MIN_DAYS} days of history.` : "No spend yet, so no forecast."
                : b.daysLeft === null
                  ? "No spend in the last 7 days, so no forecast."
                  : <>At about {usd(b.perDay)} a day (the average over the last {Math.round(b.windowDays)} days), the limit is reached in about {b.daysLeft < 1 ? "less than a day" : plural(Math.round(b.daysLeft), "day")}.</>}
          </p>
          <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); void saveLimit(); }}>
            <label className="label">New limit ($)<input className="input mt-1 w-28 tabular-nums" inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={b.limitUsd.toFixed(2)} /></label>
            <button className="btn-secondary min-h-11" disabled={!limit || busy === "budget"}>{busy === "budget" && <Spinner />}Save limit</button>
            {b.override && <button type="button" className="btn-ghost min-h-11" onClick={() => act("budget", () => api("/api/admin/budget", { method: "PUT", body: { limitUsd: null } }))}>Restore {usd(b.envUsd)}</button>}
          </form>
        </div>
      </div>
      <Disclosure title="Models" meta={d.ai.models.map((m) => m.status).join(" · ")}>
        <ul className="space-y-1 text-12">{d.ai.models.map((m) => <li key={m.role}><span className="font-medium">{m.role}</span>: <span className="font-mono">{m.resolved}</span> <span className="text-fg-2">({m.note})</span></li>)}</ul>
        <p className="mt-2 text-12 text-fg-2">
          Paid API requests since this server instance started: {num(d.ai.paidCalls.attempted)} ({plural(d.ai.paidCalls.byKind?.ai ?? 0, "AI model call")}, retries included, the same calls as the AI usage log for this period; {plural(d.ai.paidCalls.byKind?.openalex ?? 0, "OpenAlex request")} made with its API key; {plural(d.ai.paidCalls.byKind?.keyTest ?? 0, "key test")}, which use xAI&apos;s free model list). The count restarts with the server.
        </p>
      </Disclosure>

      <Modal
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        title="Turn AI off for everyone?"
        footer={<><button className="btn-secondary" onClick={() => setConfirmOff(false)}>Keep AI on</button><button className="btn-danger" onClick={async () => { setConfirmOff(false); await toggle(false); }}>Turn AI off</button></>}
      >
        <p>No model calls will be made and nothing will be spent. Running AI jobs pause at their next call and resume when you turn AI back on. Users keep their work and see a paused message. Searching PubMed and OpenAlex keeps working.</p>
      </Modal>
      <Modal
        open={!!confirmRaise}
        onClose={() => setConfirmRaise(null)}
        title="Raise the limit above the server's setting?"
        footer={<><button className="btn-secondary" onClick={() => setConfirmRaise(null)}>Cancel</button><button className="btn-danger" onClick={() => saveLimit(true)}>Raise to ${Number(limit).toFixed(2)}</button></>}
      >
        <p>{confirmRaise}</p>
        <p className="mt-2">This allows more real spend than the deployment was configured for. The change is logged.</p>
      </Modal>
    </section>
  );
}
