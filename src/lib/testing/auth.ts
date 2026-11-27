/*
 * Test-only sign-in: one user per test process owns every seeded project and holds a live session whose token
 * is in the stubbed cookie jar (./next-headers), so dispatch() -> requireUser() -> ownedProject() succeed.
 * Import "./env" before this module.
 */
import { createHash, randomBytes } from "node:crypto";
import { db, ready, schema } from "../db";
import { SESSION_COOKIE } from "../auth/policy";
import { newId } from "../util";
import { setTestCookie } from "./next-headers";

/** Large enough that credit checks never block a test that is not about credits. */
export const TEST_USER_CREDITS = 10_000_000;

let testUserId: Promise<string> | null = null;

async function createSignedInUser(): Promise<string> {
  await ready();
  const userId = newId("usr");
  await db.insert(schema.users).values({ id: userId, email: `${userId}@example.test`, name: "Test Owner", passwordHash: "not-a-real-hash", role: "user", creditsBalance: TEST_USER_CREDITS }).run();
  await signInAs(userId);
  return userId;
}

/** Start a session for userId and put its token in the cookie jar the next dispatch() reads. */
export async function signInAs(userId: string) {
  await ready();
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.insert(schema.sessions).values({
    id: createHash("sha256").update(token).digest("hex"),
    userId,
    createdAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 86_400_000).toISOString(),
  }).run();
  setTestCookie(SESSION_COOKIE, token);
}

/** The signed-in owner of seeded projects (created on first use). */
export function testUser(): Promise<string> {
  return (testUserId ??= createSignedInUser().catch((e) => {
    testUserId = null;
    throw e;
  }));
}
