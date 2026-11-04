import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { routePath } from "hono/route";
import { randomUUID } from "node:crypto";

/** One structured log record. Sinks serialise it however they like. */
export type LogEntry = Record<string, unknown>;
export type LogSink = (entry: LogEntry) => void;

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

    await next();

    const route = routePath(c);
    const ts = new Date().toISOString();
    if (c.error) {
      log({
        ts,
        level: "error",
        event: "error",
        requestId,
        method: c.req.method,
        route,
        message: c.error.message,
        stack: c.error.stack,
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
