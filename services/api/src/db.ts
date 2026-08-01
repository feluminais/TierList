import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return { db: drizzle(pool), close: () => pool.end() };
}
