import test from "node:test";
import assert from "node:assert/strict";
import {
  CHARS_PER_TOKEN,
  CREDIT_PACKS,
  TOKENS_PER_CREDIT,
  approxTokensFromChars,
  approxTokensFromText,
  calculateReviewCredits,
  estimateRetrievalCreditsFromQueries,
  findCreditPack,
  formatCredits,
  formatTokens,
  formatUsd,
  measureArticleChars,
} from "./credits";

test("approxTokensFromChars and approxTokensFromText use 4 chars per token", () => {
  assert.equal(approxTokensFromChars(0), 0);
  assert.equal(approxTokensFromChars(-10), 0);
  assert.equal(approxTokensFromChars(CHARS_PER_TOKEN), 1);
  assert.equal(approxTokensFromChars(4001), 1001);
  assert.equal(approxTokensFromText("hello world!"), 3);
  assert.equal(approxTokensFromText(null), 0);
});

test("measureArticleChars counts title, metadata, and prefers full text over abstract when present", () => {
  const short = measureArticleChars({
    title: "Telemedicine in rural clinics",
    abstract: "A".repeat(400),
    authors: ["Smith J", "Doe A"],
    journal: "Lancet",
  });
  const full = measureArticleChars({
    title: "Telemedicine in rural clinics",
    abstract: "A".repeat(400),
    authors: ["Smith J", "Doe A"],
    journal: "Lancet",
    fullTextChars: 12000,
  });
  assert.ok(short > 400);
  assert.ok(full > 12000);
  assert.equal(full - short, 12000 - 400);
});

test("calculateReviewCredits returns 0 for empty corpus and scales with article count and size", () => {
  const empty = calculateReviewCredits("retrieval", []);
  assert.equal(empty.credits, 0);
  assert.equal(empty.approxTokens, 0);
  assert.equal(empty.articleCount, 0);

  const smallCorpus = [
    { title: "Paper 1", abstract: "A".repeat(800) },
    { title: "Paper 2", abstract: "B".repeat(800) },
  ];
  const largerArticles = [
    { title: "Paper 1", abstract: "A".repeat(8000) },
    { title: "Paper 2", abstract: "B".repeat(8000) },
  ];
  const moreArticles = Array.from({ length: 20 }, (_, i) => ({
    title: `Paper ${i}`,
    abstract: "C".repeat(1600),
  }));

  for (const op of ["retrieval", "summaries", "ranking", "appraisal", "synthesis", "questions"] as const) {
    const qSmall = calculateReviewCredits(op, smallCorpus);
    const qLarge = calculateReviewCredits(op, largerArticles);
    const qMore = calculateReviewCredits(op, moreArticles);

    assert.ok(qSmall.credits >= 1, `${op} should cost at least 1 credit for non-empty corpus`);
    assert.equal(qSmall.credits, Math.max(1, Math.ceil(qSmall.approxTokens / TOKENS_PER_CREDIT)));
    assert.ok(qLarge.approxTokens > qSmall.approxTokens, `${op} approxTokens should grow with article size`);
    assert.ok(qLarge.credits >= qSmall.credits, `${op} credits should grow with article size`);
    assert.ok(qMore.approxTokens > qSmall.approxTokens, `${op} approxTokens should grow with article count`);
    assert.ok(qMore.credits > qSmall.credits, `${op} credits should grow with article count`);
  }
});

test("estimateRetrievalCreditsFromQueries respects per-query cap and deduplication", () => {
  const estSmall = estimateRetrievalCreditsFromQueries([{ dryRunCount: 5 }], 40);
  const estCapped = estimateRetrievalCreditsFromQueries([{ dryRunCount: 5000 }], 40);
  const estMulti = estimateRetrievalCreditsFromQueries([{ dryRunCount: 40 }, { dryRunCount: 40 }], 40);

  assert.equal(estSmall.articleCount, 5);
  assert.equal(estCapped.articleCount, 40);
  assert.equal(estMulti.articleCount, 60); // 80 * 0.75 dedup factor
  assert.ok(estCapped.credits > estSmall.credits);
  assert.ok(estMulti.credits > estCapped.credits);
});

test("credit packs and formatting helpers work cleanly", () => {
  assert.ok(CREDIT_PACKS.length >= 3);
  assert.equal(findCreditPack("researcher")?.credits, 1000);
  assert.equal(findCreditPack("nonexistent"), undefined);
  assert.equal(formatCredits(1250), "1,250");
  assert.equal(formatTokens(250_000), "250k");
  assert.equal(formatTokens(1_500_000), "1.5M");
  assert.equal(formatUsd(1500), "$15.00");
});
