import { serve } from "@hono/node-server";
import path from "node:path";
import { buildApp } from "./app";
import { createDb } from "./db";
import { createRepository } from "./repository";
import type { LogEntry } from "./observe";
import { createShutdown } from "./shutdown";
import { createFileStore } from "./store";

/** One JSON object per line on stdout, for whatever collects the process's logs. */
const log = (entry: LogEntry) => console.log(JSON.stringify(entry));

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Comma-separated browser origins, e.g. "https://tierlist.example". Required
// here rather than defaulted: an API that silently answers every origin is the
// wrong failure for a deploy that forgot to set it.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter((origin) => origin.length > 0);
if (allowedOrigins.length === 0) {
  console.error('ALLOWED_ORIGINS is required, e.g. ALLOWED_ORIGINS="http://localhost:3000"');
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8787);
const { db, close: closeDb } = createDb(url);
// A local directory. Swapping in an S3-compatible ObjectStore touches nothing
// above this line, because routes are typed against the interface rather than
// against an adapter.
const storageRoot = process.env.ASSET_STORAGE_ROOT ?? path.resolve(process.cwd(), "data/assets");
const app = buildApp(
  { repository: createRepository(db), store: createFileStore(storageRoot) },
  { allowedOrigins, log },
);

const server = serve({ fetch: app.fetch, port }, (info) => {
  log({ ts: new Date().toISOString(), level: "info", event: "listening", port: info.port });
});

const shutdown = createShutdown({ server, closeDb, log, exit: (code) => process.exit(code) });
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Anything that escapes a request handler and a promise chain is a bug in this
// process, whose state can no longer be trusted: say so and let the supervisor
// start a fresh one.
process.on("uncaughtException", (error) => {
  log({ ts: new Date().toISOString(), level: "error", event: "fatal", message: error.message, stack: error.stack });
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  log({ ts: new Date().toISOString(), level: "error", event: "fatal", message: error.message, stack: error.stack });
  process.exit(1);
});
