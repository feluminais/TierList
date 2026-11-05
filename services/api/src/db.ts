import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

/**
 * `onError` hears errors on idle pooled connections: the database restarting,
 * a failover, a proxy closing a connection that sat unused. The pool has
 * already discarded the client by then. With no listener Node treats the event
 * as an uncaught exception and the process dies over a connection nothing was
 * using.
 */
export function createDb(connectionString: string, onError: (error: Error) => void = () => {}) {
  const pool = new pg.Pool({ connectionString });
  pool.on("error", onError);
  return { db: drizzle(pool), pool, close: () => pool.end() };
}
