import "server-only";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { config } from "../config";

type DB = BetterSQLite3Database<typeof schema>;
const g = globalThis as unknown as { __athenaDb?: DB; __athenaSqlite?: Database.Database };

function open(): DB {
  const file = path.resolve(process.cwd(), config.databasePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  g.__athenaSqlite = sqlite;
  return db;
}

export const db: DB = g.__athenaDb ?? (g.__athenaDb = open());
export { schema };
