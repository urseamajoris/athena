import { createHmac, timingSafeEqual } from "node:crypto";

export interface ParsedStripeSignature {
  timestamp: number;
  signatures: string[];
}

/** Parse Stripe's `Stripe-Signature: t=...,v1=...,v1=...` header. */
export function parseStripeSignatureHeader(header: string | null | undefined): ParsedStripeSignature | null {
  if (!header) return null;
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === "t") timestamp = Number(val);
    else if (key === "v1" && val) signatures.push(val);
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0 || !signatures.length) return null;
  return { timestamp, signatures };
}

/**
 * Verify a Stripe webhook signature (HMAC-SHA256 over `${timestamp}.${rawBody}`) with a 5-minute replay window.
 */
export function verifyStripeSignature(
  rawBody: string,
  sigHeader: string | null | undefined,
  secret: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300,
): boolean {
  if (!secret || !sigHeader) return false;
  const parsed = parseStripeSignatureHeader(sigHeader);
  if (!parsed) return false;
  if (Math.abs(nowSec - parsed.timestamp) > toleranceSec) return false;
  const expectedHex = createHmac("sha256", secret).update(`${parsed.timestamp}.${rawBody}`, "utf8").digest("hex");
  const expectedBuf = Buffer.from(expectedHex, "utf8");
  for (const sig of parsed.signatures) {
    const actualBuf = Buffer.from(sig, "utf8");
    if (actualBuf.length === expectedBuf.length && timingSafeEqual(actualBuf, expectedBuf)) {
      return true;
    }
  }
  return false;
}
