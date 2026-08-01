import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import path from "node:path";

const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../drizzle",
);

export interface TestDb {
  db: ReturnType<typeof drizzle>;
  close: () => Promise<void>;
}

/**
 * A fresh in-memory Postgres per call. PGlite is real Postgres compiled to
 * WASM, so jsonb, constraints and transactions behave as they will in
 * production — unlike a mock or a SQLite stand-in. No daemon required.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite();
  const db = drizzle(client);
  await migrate(db, { migrationsFolder });
  return {
    db,
    close: async () => {
      await client.close();
    },
  };
}
