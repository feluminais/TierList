import { Hono } from "hono";
import { cors } from "hono/cors";
import { internalError, requestLogging, type LogSink } from "./observe";
import { applyRateLimits, type RateLimit, type RouteClass } from "./ratelimit";
import { createRoutes, type RouteDeps } from "./routes";

export interface AppOptions {
  /**
   * The browser origins allowed to call this API, such as
   * `https://tierlist.example`. When omitted, every origin is allowed, which
   * suits tests and the local scratch API and nothing else; the production
   * entry point refuses to start without a list.
   */
  allowedOrigins?: readonly string[];
  /**
   * Where structured request and error lines go. Omitted, nothing is logged:
   * tests and the scratch API stay quiet, and the production entry point
   * passes a sink that writes one JSON line to stdout.
   */
  log?: LogSink;
  /** Milliseconds, for request durations. Defaults to `Date.now`. */
  clock?: () => number;
  /** How long `/health` waits for the database before answering 503. */
  healthTimeoutMs?: number;
  /** Overrides for the per-class request limits; see `DEFAULT_RATE_LIMITS`. */
  rateLimits?: Partial<Record<RouteClass, RateLimit>>;
  /** Reverse proxies in front of this process, for reading the client address. Default 0. */
  trustedProxyHops?: number;
}

const DEFAULT_HEALTH_TIMEOUT_MS = 2000;

/** Rejects when `work` has not settled within `ms`; the timer never outlives it. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export function buildApp(deps?: RouteDeps, options: AppOptions = {}) {
  const app = new Hono();

  // First, so its line and its `x-request-id` cover every response, including
  // the ones CORS or a route produces.
  app.use("*", requestLogging({ log: options.log ?? (() => {}), clock: options.clock ?? Date.now }));
  app.onError(internalError);

  /**
   * Applied to everything, before any route.
   *
   * Reads are public by design, and the editor fetches an asset's bytes from a
   * different origin than the page, which a browser refuses without these
   * headers.
   *
   * Authentication is a bearer token the client sends deliberately, so an open
   * origin grants a hostile page nothing it could not do with `fetch` and no
   * token. Naming the origins still matters: it keeps other sites from using
   * this API from their visitors' browsers, and it is what any cookie-based
   * session would depend on.
   *
   * No `allowHeaders` option. Given none, hono reflects back whatever the
   * preflight's `Access-Control-Request-Headers` asked for, so `authorization`
   * clears preflight without being named — and a hard-coded allowlist would be
   * one more place to update the day a header is added.
   */
  app.use("*", options.allowedOrigins ? cors({ origin: [...options.allowedOrigins] }) : cors());

  // After CORS, so a 429 carries the headers a browser needs to read it.
  applyRateLimits(app, {
    limits: options.rateLimits,
    trustedProxyHops: options.trustedProxyHops,
    clock: options.clock ?? Date.now,
  });

  // With a repository, healthy means the database answers: a process whose
  // pool is dead still serves static answers, and a load balancer that only
  // saw those would keep routing to it.
  app.get("/health", async (c) => {
    if (!deps) return c.json({ status: "ok" });
    try {
      await withTimeout(deps.repository.ping(), options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS);
      return c.json({ status: "ok" });
    } catch {
      return c.json({ status: "unavailable" }, 503);
    }
  });

  if (deps) app.route("/", createRoutes(deps));

  return app;
}
