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

const port = Number(process.env.PORT ?? 8787);
const { db } = createDb(url);
// A local directory today; swaps for an S3/R2-backed ObjectStore in 1E without
// touching anything above this line, since routes are typed against the
// interface and never the adapter.
const storageRoot = process.env.ASSET_STORAGE_ROOT ?? path.resolve(process.cwd(), "data/assets");
const app = buildApp({ repository: createRepository(db), store: createFileStore(storageRoot) });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
