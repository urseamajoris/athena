import "server-only";
import { createClient, type Client } from "@libsql/client";
import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import type { BatchItem } from "drizzle-orm/batch";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { config } from "../config";

type DB = LibSQLDatabase<typeof schema>;
const g = globalThis as unknown as { __athenaDb?: DB; __athenaClient?: Client; __athenaReady?: Promise<void> };

/** Turso when TURSO_DATABASE_URL is set (with TURSO_AUTH_TOKEN); otherwise a local SQLite file (dev, tests). */
export function databaseUrl(): string {
  const remote = process.env.TURSO_DATABASE_URL?.trim();
  if (remote) return remote;
  const file = path.resolve(process.cwd(), config.databasePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return `file:${file}`;
}

function open(): DB {
  const client = createClient({ url: databaseUrl(), authToken: process.env.TURSO_AUTH_TOKEN?.trim() || undefined });
  g.__athenaClient = client;
  return drizzle(client, { schema });
}

export const db: DB = g.__athenaDb ?? (g.__athenaDb = open());

/** Applies the committed migrations in drizzle/ once per process. Awaited at server start (instrumentation). */
export function ready(): Promise<void> {
  return (g.__athenaReady ??= (async () => {
    const client = g.__athenaClient!;
    if (!process.env.TURSO_DATABASE_URL?.trim()) {
      await client.execute("PRAGMA journal_mode = WAL").catch(() => {});
      await client.execute("PRAGMA busy_timeout = 5000");
    }
    await client.execute("PRAGMA foreign_keys = ON");
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  })().catch((e) => {
    g.__athenaReady = undefined;
    throw e;
  }));
}
export { schema };

/**
 * Runs write statements atomically as one batch (a single implicit transaction on one connection).
 * Used instead of db.transaction(): a libSQL interactive transaction takes the client's connection,
 * so concurrent writes from other jobs would hit SQLITE_BUSY on a local file.
 */
export async function batchWrite(stmts: BatchItem<"sqlite">[]): Promise<void> {
  if (!stmts.length) return;
  await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}
export type { BatchItem };
