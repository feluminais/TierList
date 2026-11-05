import type { ErrorHandler, MiddlewareHandler } from "hono";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { randomUUID } from "node:crypto";

/** One structured log record. Sinks serialise it however they like. */
export type LogEntry = Record<string, unknown>;
export type LogSink = (entry: LogEntry) => void;

/**
 * What may be logged about an error.
 *
 * Drizzle wraps a failed query in an error whose message is the SQL and its
 * bound parameters, which here are share codes, list ids, token hashes and
 * whole documents: exactly what this module promises never to log. The
 * driver's own error, which it carries as `cause`, says what went wrong
 * without them.
 */
function loggable(error: Error): Error {
  if (!(error instanceof DrizzleQueryError)) return error;
  return error.cause instanceof Error ? error.cause : new Error("database query failed");
}

export interface Observation {
  log: LogSink;
  /** Milliseconds. Injected so a test can make durations exact. */
  clock: () => number;
}

/**
 * One `request` line per request, and one `error` line more when a handler
 * threw. Both carry the same fresh `requestId`, which the response returns in
 * `x-request-id` so a report from a browser can be matched to a log line.
 *
 * The request id is always generated here: an id the caller supplies would let
 * them forge or collide with another request's lines.
 *
 * What is logged is the route *pattern* (`/lists/:id`), never the path. A list
 * id or a share code in a path is the capability to read that list, and a log
 * is read by more people than the list's owner. Headers and bodies are never
 * logged, so a bearer token cannot reach a log.
 */
export function requestLogging({ log, clock }: Observation): MiddlewareHandler {
  return async (c, next) => {
    const requestId = randomUUID();
    const started = clock();
    c.header("x-request-id", requestId);

    try {
      await next();
    } catch (thrown) {
      // Hono hands an `Error` to the error handler itself; anything else a
      // handler throws (a rejected string, say) would otherwise escape it with
      // no body, no request id and no log line.
      c.error = thrown instanceof Error ? thrown : new Error(String(thrown));
      c.res = await internalError(c.error, c);
    }

    const route = routePath(c);
    const ts = new Date().toISOString();
    if (c.error) {
      const error = loggable(c.error);
      log({
        ts,
        level: "error",
        event: "error",
        requestId,
        method: c.req.method,
        route,
        message: error.message,
        stack: error.stack,
      });
    }
    log({
      ts,
      level: "info",
      event: "request",
      requestId,
      method: c.req.method,
      route,
      status: c.res.status,
      durationMs: clock() - started,
    });
  };
}

/**
 * The answer to an error no route handled. The body is fixed text: an error's
 * own message can name a table, a constraint or a path, and a client gets none
 * of that. The detail goes to the log, where `requestLogging` finds it on
 * `c.error`.
 */
export const internalError: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  return c.json({ error: "internal error" }, 500);
};
