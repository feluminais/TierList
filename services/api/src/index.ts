import { serve } from "@hono/node-server";
import path from "node:path";
import { buildApp } from "./app";
import { createDb } from "./db";
import { createRepository } from "./repository";
import { createFileStore } from "./store";

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
const { db } = createDb(url);
// A local directory. Swapping in an S3-compatible ObjectStore touches nothing
// above this line, because routes are typed against the interface rather than
// against an adapter.
const storageRoot = process.env.ASSET_STORAGE_ROOT ?? path.resolve(process.cwd(), "data/assets");
const app = buildApp(
  { repository: createRepository(db), store: createFileStore(storageRoot) },
  { allowedOrigins },
);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
