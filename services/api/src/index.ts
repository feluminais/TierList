import { serve } from "@hono/node-server";
import { buildApp } from "./app";
import { createDb } from "./db";
import { createRepository } from "./repository";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 8787);
const { db } = createDb(url);
const app = buildApp({ repository: createRepository(db) });

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`api listening on http://localhost:${info.port}`);
});
