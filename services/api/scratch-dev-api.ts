/**
 * A local API for driving the web app by hand.
 *
 * `src/index.ts` wants a Postgres daemon. This mounts the same routes over
 * PGlite — real Postgres compiled to WASM, so jsonb, constraints and
 * transactions behave as they do in production — plus an in-memory object
 * store.
 *
 * Everything is in memory and disappears when this stops: lists, assets, share
 * codes and **device tokens**. The editor re-mints a token the server no
 * longer recognises, so a restart costs the data rather than the session.
 *
 * It runs without `--watch`, so restart it after changing anything it imports.
 * A `SCHEMA_VERSION` bump in the browser's bundle against an older process
 * here makes every write fail validation.
 */
import { serve } from "@hono/node-server";
import { buildApp } from "./src/app";
import { createRepository } from "./src/repository";
import { createMemoryStore } from "./src/store";
import { createTestDb } from "./test/helpers/pglite";

const { db } = await createTestDb();
// Do not add `hono/cors` here: `buildApp` applies it. A second copy emits
// `Access-Control-Allow-Origin` twice, which a browser rejects outright.
const app = buildApp({ repository: createRepository(db), store: createMemoryStore() });

serve({ fetch: app.fetch, port: 8788 }, (info) => {
  console.log(`scratch API on http://localhost:${info.port}`);
});
