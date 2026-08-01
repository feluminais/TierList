import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "./db";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

// Resolved from this file, not the working directory: the CLI is run from the
// repo root, from services/api, and from containers with their own WORKDIR,
// and a cwd-relative path silently finds nothing in two of those three.
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../drizzle",
);

const { db, close } = createDb(url);
await migrate(db, { migrationsFolder });
await close();
console.log("migrations applied");
