import "server-only";
import { and, desc, eq, gte, notInArray, sql } from "drizzle-orm";
import { batchWrite, db, schema, type BatchItem } from "../db";
import { errMsg, newId } from "../util";
import { NO_CREDITS_MESSAGE } from "../ai/errors";
import type { Role } from "../db/schema";
import { billingConfig, stripeReady } from "./config";
import { CREDIT_PACKS, type CreditPack } from "./packs";
import { creditsFor, shownBalance } from "./rules";

// Computing credits. Each account has a balance (users.credit_balance). AI calls take credits from the account
// that owns the project; purchases, the sign-up grant, admin grants and refunds change it through the ledger
// (credit_ledger). Administrators are never charged and never blocked.

export interface Payer {
  userId: string;
  exempt: boolean;
  /** The balance when this was read. Read the payer again before each new call. */
  balance: number;
}

export const isExempt = (u: { role: Role }) => u.role === "admin";

/** The account that pays for a project's AI calls: its owner. null when there is no project or no owner. */
export async function payerFor(projectId: string | null | undefined): Promise<Payer | null> {
  if (!projectId) return null;
  const row = await db
    .select({ userId: schema.users.id, role: schema.users.role, balance: schema.users.creditBalance })
    .from(schema.projects)
    .innerJoin(schema.users, eq(schema.users.id, schema.projects.ownerId))
    .where(eq(schema.projects.id, projectId))
    .get();
  return row ? { userId: row.userId, exempt: isExempt(row), balance: row.balance } : null;
}

/** May this payer start an AI call? null payer and administrators (exempt): yes. Otherwise balance > 0. */
export function canSpend(p: Payer | null): boolean {
  return !p || p.exempt || p.balance > 0;
}

/** Credits for a model cost: costUsd x CREDITS_PER_USD_COST, rounded to 3 decimals. */
export function creditsForCost(costUsd: number): number {
  return creditsFor(costUsd, billingConfig.creditsPerUsdCost);
}

/**
 * Take the credits for a finished call from the balance. One atomic UPDATE, so calls that finish together
 * cannot overwrite each other. Returns the credits taken (0 if exempt or null).
 */
export async function charge(p: Payer | null, costUsd: number): Promise<number> {
  if (!p || p.exempt) return 0;
  const credits = creditsForCost(costUsd);
  if (credits <= 0) return 0;
  await db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} - ${credits}` }).where(eq(schema.users.id, p.userId)).run();
  return credits;
}

/** The stored balance (it can be slightly below zero), or 0 for an unknown account. Show it with shownBalance. */
export async function balanceOf(userId: string): Promise<number> {
  const r = await db.select({ balance: schema.users.creditBalance }).from(schema.users).where(eq(schema.users.id, userId)).get();
  return r?.balance ?? 0;
}

// ---------- the ledger ----------

export type LedgerKind = "purchase" | "signup" | "grant" | "refund";

export interface LedgerInput {
  kind: LedgerKind;
  /** A fixed row ID makes the entry happen once (a second insert with the same ID adds nothing). */
  id?: string;
  /** US dollars paid (purchase) or returned (refund, negative). */
  amountUsd?: number | null;
  packId?: string | null;
  /** Unique: a Checkout Session is credited once however often Stripe reports it. */
  stripeSessionId?: string | null;
  stripePaymentIntent?: string | null;
  /** The administrator who made a grant. */
  actorId?: string | null;
  note?: string | null;
}

/** The ledger row and the balance change, to run together in one batch. `credits` is signed. */
export function ledgerStatements(userId: string, credits: number, entry: LedgerInput): BatchItem<"sqlite">[] {
  return [
    // The ledger row goes first: if it is a duplicate, the batch fails on the unique index and the balance is untouched.
    db.insert(schema.creditLedger).values({
      id: entry.id ?? newId("cl"),
      userId,
      kind: entry.kind,
      credits,
      amountUsd: entry.amountUsd ?? null,
      packId: entry.packId ?? null,
      stripeSessionId: entry.stripeSessionId ?? null,
      stripePaymentIntent: entry.stripePaymentIntent ?? null,
      actorId: entry.actorId ?? null,
      note: entry.note ?? null,
    }),
    db.update(schema.users).set({ creditBalance: sql`${schema.users.creditBalance} + ${credits}` }).where(eq(schema.users.id, userId)),
  ];
}

/** A write refused because the row already exists (unique index or primary key). */
function isDuplicate(e: unknown): boolean {
  for (let x: unknown = e, depth = 0; x && depth < 5; x = (x as { cause?: unknown }).cause, depth++) {
    const { code, message } = x as { code?: unknown; message?: unknown };
    if (typeof code === "string" && /^SQLITE_CONSTRAINT_(UNIQUE|PRIMARYKEY)$/.test(code)) return true;
    if (typeof message === "string" && /UNIQUE constraint failed/i.test(message)) return true;
  }
  return false;
}

/**
 * Adds credits to (or, with a negative number, removes them from) an account and writes the ledger row, as one
 * atomic batch. An entry that already exists (same Stripe session, or same fixed ID) changes nothing and reports
 * `added: false`: that is how a purchase reported twice is credited once. After a top-up, the account's jobs
 * that had paused for lack of credits carry on.
 */
export async function addCredits(userId: string, credits: number, entry: LedgerInput): Promise<{ added: boolean; balance: number }> {
  try {
    await batchWrite(ledgerStatements(userId, credits, entry));
  } catch (e) {
    if (isDuplicate(e)) return { added: false, balance: await balanceOf(userId) };
    throw e;
  }
  if (credits > 0) await resumeAfterTopUp(userId);
  return { added: true, balance: await balanceOf(userId) };
}

/** Jobs of this account that paused because the balance ran out start again, once there is something to spend. */
async function resumeAfterTopUp(userId: string): Promise<void> {
  try {
    const u = await db.select({ role: schema.users.role, balance: schema.users.creditBalance }).from(schema.users).where(eq(schema.users.id, userId)).get();
    if (!u || (!isExempt(u) && u.balance <= 0)) return;
    // Loaded here, not at the top: the job handlers use the AI client, which uses this file.
    await import("../jobs"); // registers the job handlers in this process
    const { resumeJobsPausedWith } = await import("../jobs/runner");
    await resumeJobsPausedWith(NO_CREDITS_MESSAGE, userId);
  } catch (e) {
    // The credits are in the account either way; the person can press Resume.
    console.error("[athena] could not resume jobs after credits were added:", errMsg(e));
  }
}

// ---------- what an account may see ----------

export interface LedgerEntry {
  id: string;
  kind: LedgerKind;
  /** Signed: positive adds, negative removes. */
  credits: number;
  /** US dollars paid (purchase) or returned (refund, negative); null for sign-up credits and grants. */
  amountUsd: number | null;
  packId: string | null;
  note: string | null;
  createdAt: string;
}

/** The account's ledger, newest first. No Stripe IDs and no administrator's identity. */
export async function creditHistory(userId: string, limit = 50): Promise<LedgerEntry[]> {
  const L = schema.creditLedger;
  const q = db.select({ id: L.id, kind: L.kind, credits: L.credits, amountUsd: L.amountUsd, packId: L.packId, note: L.note, createdAt: L.createdAt }).from(L).where(eq(L.userId, userId)).orderBy(desc(L.createdAt), desc(sql`rowid`));
  return limit > 0 ? q.limit(limit).all() : q.all();
}

export interface ProjectUsage {
  projectId: string | null;
  /** null when the project has been deleted. */
  title: string | null;
  credits: number;
  /** AI calls that were sent (refused and paused attempts are not counted). */
  calls: number;
  lastUsedAt: string | null;
}
export interface DayUsage {
  /** UTC date, YYYY-MM-DD. */
  day: string;
  credits: number;
  calls: number;
}
export interface CreditUsage {
  totalCredits: number;
  totalCalls: number;
  /** Most credits first. */
  byProject: ProjectUsage[];
  /** The last 30 days, oldest first, one entry per day (zeros included). */
  byDay: DayUsage[];
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const SENT = notInArray(schema.aiCalls.status, ["refused", "paused"]);

/** Credits this account has used, per project and per day, from ai_calls. */
export async function creditUsage(userId: string, nowMs = Date.now()): Promise<CreditUsage> {
  const A = schema.aiCalls;
  const mine = and(eq(A.userId, userId), SENT);
  const projects = await db
    .select({ projectId: A.projectId, title: schema.projects.title, credits: sql<number>`coalesce(sum(${A.credits}),0)`, calls: sql<number>`count(*)`, lastUsedAt: sql<string | null>`max(${A.createdAt})` })
    .from(A)
    // Only this account's own projects supply a title.
    .leftJoin(schema.projects, and(eq(schema.projects.id, A.projectId), eq(schema.projects.ownerId, userId)))
    .where(mine)
    .groupBy(A.projectId)
    .orderBy(desc(sql`sum(${A.credits})`), desc(sql`max(${A.createdAt})`))
    .all();
  const since = new Date(nowMs - 29 * 86_400_000).toISOString().slice(0, 10);
  const days = await db
    .select({ day: sql<string>`substr(${A.createdAt}, 1, 10)`, credits: sql<number>`coalesce(sum(${A.credits}),0)`, calls: sql<number>`count(*)` })
    .from(A)
    .where(and(mine, gte(A.createdAt, since)))
    .groupBy(sql`substr(${A.createdAt}, 1, 10)`)
    .all();
  const byDay: DayUsage[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = new Date(nowMs - i * 86_400_000).toISOString().slice(0, 10);
    const d = days.find((x) => x.day === day);
    byDay.push({ day, credits: round3(d?.credits ?? 0), calls: d?.calls ?? 0 });
  }
  return {
    totalCredits: round3(projects.reduce((a, p) => a + p.credits, 0)),
    totalCalls: projects.reduce((a, p) => a + p.calls, 0),
    byProject: projects.map((p) => ({ projectId: p.projectId, title: p.title ?? null, credits: round3(p.credits), calls: p.calls, lastUsedAt: p.lastUsedAt })),
    byDay,
  };
}

export interface BalanceView {
  /** Credits left, never below 0. */
  balance: number;
  /** Administrators: AI steps take no credits and never stop for lack of them. */
  exempt: boolean;
}

export async function balanceView(user: { id: string; role: Role }): Promise<BalanceView> {
  return { balance: shownBalance(await balanceOf(user.id)), exempt: isExempt(user) };
}

export interface BillingView extends BalanceView {
  /** Can credits be bought on this server right now? False until the owner sets up Stripe. */
  stripeReady: boolean;
  /** Credits taken per US dollar of AI cost. */
  creditsPerUsdCost: number;
  packs: CreditPack[];
  /** Purchases, sign-up credits, grants and refunds, newest first (at most 50). */
  history: LedgerEntry[];
  usage: CreditUsage;
}

/** GET /api/billing: everything the credits page shows for the signed-in account. */
export async function billingView(user: { id: string; role: Role }): Promise<BillingView> {
  const [b, history, usage] = await Promise.all([balanceView(user), creditHistory(user.id, 50), creditUsage(user.id)]);
  return { ...b, stripeReady: stripeReady(), creditsPerUsdCost: billingConfig.creditsPerUsdCost, packs: CREDIT_PACKS, history, usage };
}
