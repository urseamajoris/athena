import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema, batchWrite } from "../db";
import { config } from "../config";
import { InsufficientCreditsError } from "../ai/errors";
import { newId, nowIso } from "../util";
import {
  CREDIT_PACKS,
  STAGE_PROFILES,
  calculateReviewCredits,
  estimateRetrievalCreditsFromQueries,
  operationLabel,
  type ArticleSizeInput,
  type CreditQuote,
  type ReviewStageOperation,
} from "../shared/credits";
import { isStripeCheckoutConfigured, isStripeConfigured, paymentLinkForPack } from "./stripe";

export async function getUserCredits(userId: string): Promise<number> {
  const u = await db
    .select({ creditsBalance: schema.users.creditsBalance })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .get();
  return u?.creditsBalance ?? 0;
}

/** Build article size inputs for a given literature-review stage from the project's stored records. */
export async function quoteProjectStage(
  projectId: string,
  operation: ReviewStageOperation,
  opts?: { cap?: number; paperIds?: string[] },
): Promise<CreditQuote> {
  if (operation === "retrieval") {
    const qs = await db
      .select({ dryRunCount: schema.queries.dryRunCount })
      .from(schema.queries)
      .where(eq(schema.queries.projectId, projectId))
      .all();
    return estimateRetrievalCreditsFromQueries(qs, opts?.cap ?? config.maxResultsPerQuery);
  }

  if (operation === "summaries") {
    const papers = await db
      .select({
        title: schema.papers.title,
        abstract: schema.papers.abstract,
        authors: schema.papers.authors,
        journal: schema.papers.journal,
      })
      .from(schema.papers)
      .where(eq(schema.papers.projectId, projectId))
      .all();
    return calculateReviewCredits("summaries", papers);
  }

  if (operation === "ranking") {
    const papers = await db
      .select({
        title: schema.papers.title,
        abstract: schema.papers.abstract,
        authors: schema.papers.authors,
        journal: schema.papers.journal,
      })
      .from(schema.papers)
      .where(eq(schema.papers.projectId, projectId))
      .all();
    return calculateReviewCredits("ranking", papers);
  }

  // Stages 7, 8, 9 (appraisal, synthesis, research questions) operate on selected non-excluded papers.
  const topics = await db
    .select({ id: schema.topics.id })
    .from(schema.topics)
    .where(eq(schema.topics.projectId, projectId))
    .all();
  const topicIds = topics.map((t) => t.id);
  const selectedScores = topicIds.length
    ? await db
        .select({ paperId: schema.scores.paperId })
        .from(schema.scores)
        .where(and(inArray(schema.scores.topicId, topicIds), eq(schema.scores.selected, true)))
        .all()
    : [];
  let pids = [...new Set(selectedScores.map((s) => s.paperId))];
  if (opts?.paperIds?.length) {
    const allow = new Set(opts.paperIds);
    pids = pids.filter((id) => allow.has(id));
  }
  if (!pids.length) return calculateReviewCredits(operation, []);

  const papers = (
    await db
      .select({
        id: schema.papers.id,
        title: schema.papers.title,
        abstract: schema.papers.abstract,
        authors: schema.papers.authors,
        journal: schema.papers.journal,
        excluded: schema.papers.excluded,
      })
      .from(schema.papers)
      .where(inArray(schema.papers.id, pids))
      .all()
  ).filter((p) => !p.excluded);

  if (!papers.length) return calculateReviewCredits(operation, []);

  if (operation === "appraisal") {
    const activeIds = papers.map((p) => p.id);
    const texts = await db
      .select({ paperId: schema.sourceTexts.paperId, fullLength: schema.sourceTexts.fullLength })
      .from(schema.sourceTexts)
      .where(inArray(schema.sourceTexts.paperId, activeIds))
      .all();
    const textLenByPaper = new Map<string, number>();
    for (const t of texts) {
      const capped = Math.min(t.fullLength, config.appraisalMaxChars);
      textLenByPaper.set(t.paperId, Math.max(textLenByPaper.get(t.paperId) ?? 0, capped));
    }
    const inputs: ArticleSizeInput[] = papers.map((p) => ({
      title: p.title,
      abstract: p.abstract,
      authors: p.authors,
      journal: p.journal,
      fullTextChars: textLenByPaper.get(p.id) ?? null,
    }));
    return calculateReviewCredits("appraisal", inputs);
  }

  // Synthesis & Research questions: measure selected papers + their extracted claims/synthesis size.
  const activeIds = papers.map((p) => p.id);
  const claims = await db
    .select({ paperId: schema.claims.paperId, statement: schema.claims.statement, quote: schema.claims.quote })
    .from(schema.claims)
    .where(inArray(schema.claims.paperId, activeIds))
    .all();
  const claimCharsByPaper = new Map<string, number>();
  for (const c of claims) {
    const len = (c.statement?.length ?? 0) + (c.quote?.length ?? 0);
    claimCharsByPaper.set(c.paperId, (claimCharsByPaper.get(c.paperId) ?? 0) + len);
  }
  const inputs: ArticleSizeInput[] = papers.map((p) => ({
    title: p.title,
    abstract: p.abstract,
    authors: p.authors,
    journal: p.journal,
    fullTextChars: claimCharsByPaper.get(p.id) ?? null,
  }));
  return calculateReviewCredits(operation, inputs);
}

/** Measure the actual gathered papers of a project for data gathering (Stage 4) credit calculation. */
export async function quoteGatheredPapers(projectId: string): Promise<CreditQuote> {
  const papers = await db
    .select({
      title: schema.papers.title,
      abstract: schema.papers.abstract,
      authors: schema.papers.authors,
      journal: schema.papers.journal,
    })
    .from(schema.papers)
    .where(eq(schema.papers.projectId, projectId))
    .all();
  return calculateReviewCredits("retrieval", papers);
}

/** Verify the project owner has enough credits for a stage before running it. Throws InsufficientCreditsError if not. */
export async function ensureCreditsForStage(
  projectId: string,
  operation: ReviewStageOperation,
  quote: CreditQuote,
): Promise<{ ownerId: string | null; balance: number }> {
  const proj = await db
    .select({ ownerId: schema.projects.ownerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  const ownerId = proj?.ownerId ?? null;
  if (!ownerId || quote.credits <= 0) return { ownerId, balance: Number.POSITIVE_INFINITY };
  const balance = await getUserCredits(ownerId);
  if (balance < quote.credits) {
    throw new InsufficientCreditsError(quote.credits, balance, quote.label, quote.approxTokens, quote.articleCount);
  }
  return { ownerId, balance };
}

/**
 * Deduct credits for a literature review job. Idempotent per (jobId, operation) so a resumed job is never
 * charged twice. When `allowClampToZero` is true (used after retrieval finishes if actual gathered articles
 * slightly exceeded the pre-run dry-run estimate), balance is clamped to 0 instead of failing after the work is done.
 */
export async function chargeCreditsForJob(params: {
  projectId: string;
  jobId: string;
  operation: ReviewStageOperation;
  quote: CreditQuote;
  allowClampToZero?: boolean;
}): Promise<{ charged: number; balanceAfter: number | null }> {
  const { projectId, jobId, operation, quote, allowClampToZero } = params;
  if (quote.credits <= 0) return { charged: 0, balanceAfter: null };

  const proj = await db
    .select({ ownerId: schema.projects.ownerId })
    .from(schema.projects)
    .where(eq(schema.projects.id, projectId))
    .get();
  const ownerId = proj?.ownerId ?? null;
  if (!ownerId) return { charged: 0, balanceAfter: null };

  // Idempotency guard: if this job already recorded a charge for this operation, do not double-charge.
  const existing = await db
    .select({ id: schema.creditTransactions.id, amount: schema.creditTransactions.amount, balanceAfter: schema.creditTransactions.balanceAfter })
    .from(schema.creditTransactions)
    .where(and(eq(schema.creditTransactions.jobId, jobId), eq(schema.creditTransactions.operation, operation)))
    .get();
  if (existing) {
    return { charged: Math.abs(existing.amount), balanceAfter: existing.balanceAfter };
  }

  const currentBalance = await getUserCredits(ownerId);
  if (!allowClampToZero && currentBalance < quote.credits) {
    throw new InsufficientCreditsError(quote.credits, currentBalance, quote.label, quote.approxTokens, quote.articleCount);
  }
  const actualCharge = allowClampToZero ? Math.min(currentBalance, quote.credits) : quote.credits;
  const nextBalance = Math.max(0, currentBalance - actualCharge);
  const profile = STAGE_PROFILES[operation];
  const description = `${profile.label}: ${quote.articleCount} article${quote.articleCount === 1 ? "" : "s"} (~${quote.approxTokens.toLocaleString("en-US")} tokens)`;

  await batchWrite([
    db.update(schema.users).set({ creditsBalance: nextBalance }).where(eq(schema.users.id, ownerId)),
    db.insert(schema.creditTransactions).values({
      id: newId("crd"),
      userId: ownerId,
      projectId,
      jobId,
      stage: profile.stage,
      operation,
      amount: -actualCharge,
      balanceAfter: nextBalance,
      articleCount: quote.articleCount,
      totalChars: quote.totalChars,
      approxTokens: quote.approxTokens,
      description,
      createdAt: nowIso(),
    }),
  ]);

  return { charged: actualCharge, balanceAfter: nextBalance };
}

/**
 * Idempotently apply a Stripe credit top-up to a user's balance. Safe to call from both the Stripe webhook
 * and the /credits?status=success return handler: `stripeSessionId` has a unique constraint.
 */
export async function applyStripeTopUp(params: {
  userId: string;
  credits: number;
  stripeSessionId: string;
  amountCents?: number | null;
  packName?: string;
}): Promise<{ alreadyApplied: boolean; balance: number; creditsAdded: number }> {
  const { userId, credits, stripeSessionId, amountCents, packName } = params;
  const existing = await db
    .select({ id: schema.creditTransactions.id, balanceAfter: schema.creditTransactions.balanceAfter })
    .from(schema.creditTransactions)
    .where(eq(schema.creditTransactions.stripeSessionId, stripeSessionId))
    .get();
  if (existing) {
    return { alreadyApplied: true, balance: await getUserCredits(userId), creditsAdded: 0 };
  }

  const currentBalance = await getUserCredits(userId);
  const nextBalance = currentBalance + credits;
  const description = packName
    ? `Stripe top-up (${packName} pack: +${credits.toLocaleString("en-US")} credits)`
    : `Stripe top-up (+${credits.toLocaleString("en-US")} credits)`;

  try {
    await batchWrite([
      db.update(schema.users).set({ creditsBalance: nextBalance }).where(eq(schema.users.id, userId)),
      db.insert(schema.creditTransactions).values({
        id: newId("crd"),
        userId,
        operation: "top_up",
        amount: credits,
        balanceAfter: nextBalance,
        stripeSessionId,
        amountCents: amountCents ?? null,
        description,
        createdAt: nowIso(),
      }),
    ]);
  } catch (e) {
    // Handle race between webhook and return-URL verification hitting the unique stripe_session_id index.
    const dup = await db
      .select({ id: schema.creditTransactions.id })
      .from(schema.creditTransactions)
      .where(eq(schema.creditTransactions.stripeSessionId, stripeSessionId))
      .get();
    if (dup) {
      return { alreadyApplied: true, balance: await getUserCredits(userId), creditsAdded: 0 };
    }
    throw e;
  }

  return { alreadyApplied: false, balance: nextBalance, creditsAdded: credits };
}

/** User's credit balance, packs, usage summary, and transaction ledger for /credits and /api/credits. */
export async function creditsView(user: { id: string; email: string }) {
  const balance = await getUserCredits(user.id);
  const rows = await db
    .select({
      id: schema.creditTransactions.id,
      projectId: schema.creditTransactions.projectId,
      projectTitle: schema.projects.title,
      stage: schema.creditTransactions.stage,
      operation: schema.creditTransactions.operation,
      amount: schema.creditTransactions.amount,
      balanceAfter: schema.creditTransactions.balanceAfter,
      articleCount: schema.creditTransactions.articleCount,
      totalChars: schema.creditTransactions.totalChars,
      approxTokens: schema.creditTransactions.approxTokens,
      amountCents: schema.creditTransactions.amountCents,
      description: schema.creditTransactions.description,
      createdAt: schema.creditTransactions.createdAt,
    })
    .from(schema.creditTransactions)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.creditTransactions.projectId))
    .where(eq(schema.creditTransactions.userId, user.id))
    .orderBy(desc(schema.creditTransactions.createdAt))
    .limit(100)
    .all();

  const agg = await db
    .select({
      totalUsed: sql<number>`coalesce(sum(case when ${schema.creditTransactions.amount} < 0 then -${schema.creditTransactions.amount} else 0 end), 0)`,
      totalToppedUp: sql<number>`coalesce(sum(case when ${schema.creditTransactions.operation} = 'top_up' then ${schema.creditTransactions.amount} else 0 end), 0)`,
      totalApproxTokens: sql<number>`coalesce(sum(coalesce(${schema.creditTransactions.approxTokens}, 0)), 0)`,
      totalArticlesProcessed: sql<number>`coalesce(sum(coalesce(${schema.creditTransactions.articleCount}, 0)), 0)`,
    })
    .from(schema.creditTransactions)
    .where(eq(schema.creditTransactions.userId, user.id))
    .get();

  const checkoutConfigured = isStripeCheckoutConfigured();
  const packs = CREDIT_PACKS.map((pack) => {
    const link = paymentLinkForPack(pack.id, user);
    return {
      ...pack,
      available: checkoutConfigured || !!link,
      paymentLinkUrl: !checkoutConfigured ? link : null,
    };
  });

  return {
    balance,
    stripeConfigured: isStripeConfigured(),
    stripeMode: checkoutConfigured ? "checkout" : packs.some((p) => p.paymentLinkUrl) ? "payment_link" : "unconfigured",
    packs,
    summary: {
      totalUsed: agg?.totalUsed ?? 0,
      totalToppedUp: agg?.totalToppedUp ?? 0,
      totalApproxTokens: agg?.totalApproxTokens ?? 0,
      totalArticlesProcessed: agg?.totalArticlesProcessed ?? 0,
    },
    transactions: rows.map((r) => ({
      ...r,
      operationLabel: operationLabel(r.operation),
    })),
  };
}

/** Per-project credit breakdown: past charges and live token-based estimates for each literature review stage. */
export async function projectCreditsView(projectId: string) {
  const [retrieval, summaries, ranking, appraisal, synthesis, questions, history] = await Promise.all([
    quoteProjectStage(projectId, "retrieval"),
    quoteProjectStage(projectId, "summaries"),
    quoteProjectStage(projectId, "ranking"),
    quoteProjectStage(projectId, "appraisal"),
    quoteProjectStage(projectId, "synthesis"),
    quoteProjectStage(projectId, "questions"),
    db
      .select()
      .from(schema.creditTransactions)
      .where(eq(schema.creditTransactions.projectId, projectId))
      .orderBy(desc(schema.creditTransactions.createdAt))
      .all(),
  ]);

  return {
    estimates: { retrieval, summaries, ranking, appraisal, synthesis, questions },
    totalUsed: history.reduce((sum, r) => sum + (r.amount < 0 ? -r.amount : 0), 0),
    transactions: history.map((r) => ({
      id: r.id,
      stage: r.stage,
      operation: r.operation,
      operationLabel: operationLabel(r.operation),
      amount: r.amount,
      articleCount: r.articleCount,
      totalChars: r.totalChars,
      approxTokens: r.approxTokens,
      description: r.description,
      createdAt: r.createdAt,
    })),
  };
}
