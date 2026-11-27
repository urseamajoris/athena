/*
 * Test bootstrap: import this FIRST in a test file. It points the app at a throwaway SQLite file, forces
 * MOCK_MODE (fixtures for HTTP, mock model responders, no xAI calls) and lets plain Node import modules that
 * are marked "server-only" (the marker package throws outside a React Server bundle).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "athena-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
process.env.MOCK_MODE = "true";
process.env.XAI_API_KEY = "";
process.env.SIMULATE_SOURCE_FAILURE = "";
process.on("exit", () => fs.rmSync(dir, { recursive: true, force: true }));

const req = createRequire(__filename);
const marker = req.resolve("server-only");
req.cache[marker] = { id: marker, filename: marker, loaded: true, exports: {} } as unknown as NodeModule;

// next/headers outside a request scope throws; route code (dispatch -> requireUser) reads the session cookie.
(req("./next-headers") as typeof import("./next-headers")).installNextHeadersStub();

// Production has no mock mode: give AI steps a deterministic test-only responder (see ./fake-ai). No key, no network.
(req("./fake-ai") as typeof import("./fake-ai")).installFakeAi();

// Production has no HTTP fixture replay: literature APIs get synthetic answers, anything else fails (see ./fake-fetch).
(req("./fake-fetch") as typeof import("./fake-fetch")).installFakeFetch();
