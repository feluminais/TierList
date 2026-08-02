/**
 * A throwaway API for driving the web app by hand.
 *
 * The real `src/index.ts` wants a Postgres daemon. This mounts the same routes
 * over PGlite — real Postgres compiled to WASM, so jsonb, constraints and
 * transactions behave as they will in production — plus an in-memory object
 * store and permissive CORS.
 *
 * Everything is in memory, so it all disappears when this stops: lists,
 * assets, share codes and **device tokens**. A stale token in a browser's
 * localStorage then surfaces as "Save failed — retrying", which is expected
 * rather than a bug — clear it, or use a fresh profile.
 *
 * Not committed. Delete it when you are done.
 */
import { serve } from "@hono/node-server";
import { buildApp } from "./src/app";
import { createRepository } from "./src/repository";
import { createMemoryStore } from "./src/store";
import { createTestDb } from "./test/helpers/pglite";

const { db } = await createTestDb();
// No `hono/cors` here: `buildApp` has applied it itself since Milestone 3B.
// Adding a second copy emits `Access-Control-Allow-Origin` twice, which a
// browser rejects outright — so the harness that used to need it now breaks
// the thing it was added to fix.
const app = buildApp({ repository: createRepository(db), store: createMemoryStore() });

serve({ fetch: app.fetch, port: 8788 }, (info) => {
  console.log(`scratch API on http://localhost:${info.port}`);
});
