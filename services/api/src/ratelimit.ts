import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context, MiddlewareHandler } from "hono";

export interface RateLimit {
  /** Requests allowed per key in one window. */
  limit: number;
  windowMs: number;
}

export interface Verdict {
  allowed: boolean;
  /** Whole seconds until the key's window ends; meaningful when not allowed. */
  retryAfterSeconds: number;
}

export interface Limiter {
  check: (key: string) => Verdict;
}

/** The most keys a limiter remembers, so a flood of addresses cannot grow it without bound. */
export const MAX_TRACKED_KEYS = 10_000;

/**
 * A fixed-window counter per key, held in this process.
 *
 * Each key gets `limit` requests per `windowMs`, counted from its first
 * request in the window. Memory is bounded: expired windows are dropped when
 * the table fills, and if live windows alone exceed the cap the oldest are
 * evicted, which forgives their count rather than refusing new keys.
 *
 * It is per process. Behind several replicas each enforces its own count, so
 * the effective limit is the configured one times the replicas. The clock is
 * passed in so a test decides when a window ends.
 */
export function createLimiter(config: RateLimit, clock: () => number): Limiter {
  const windows = new Map<string, { count: number; resetAt: number }>();

  function makeRoom(now: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
    // Map iteration is insertion order, so these are the oldest windows.
    for (const key of windows.keys()) {
      if (windows.size < MAX_TRACKED_KEYS) break;
      windows.delete(key);
    }
  }

  return {
    check(key) {
      const now = clock();
      const current = windows.get(key);

      if (!current || current.resetAt <= now) {
        if (!current && windows.size >= MAX_TRACKED_KEYS) makeRoom(now);
        windows.set(key, { count: 1, resetAt: now + config.windowMs });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      if (current.count < config.limit) {
        current.count += 1;
        return { allowed: true, retryAfterSeconds: 0 };
      }

      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
      };
    },
  };
}

/**
 * Who a request is from.
 *
 * By default the socket's own address: a header the caller writes cannot move
 * them into another bucket. Behind a reverse proxy that address is the
 * proxy's, so `trustedProxyHops` says how many proxies sit in front; the
 * address is then read that many entries from the *right* of `X-Forwarded-For`,
 * which is what the nearest trusted proxy appended. Entries further left were
 * written by the client and are never used.
 *
 * With no socket to read (a test calling the app directly) every request
 * shares one address, `unknown`.
 */
export function clientAddress(c: Context, trustedProxyHops: number): string {
  if (trustedProxyHops > 0) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      const hops = forwarded.split(",").map((entry) => entry.trim());
      const entry = hops[hops.length - trustedProxyHops];
      if (entry) return entry;
    }
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Refuses a request past its limit with 429 and `Retry-After`. The key is the
 * client address, so one noisy client cannot spend another's allowance.
 */
export function rateLimit(limiter: Limiter, addressOf: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    const verdict = limiter.check(addressOf(c));
    if (!verdict.allowed) {
      c.header("retry-after", String(verdict.retryAfterSeconds));
      return c.json({ error: "too many requests" }, 429);
    }
    await next();
  };
}

/** The kinds of request that are counted separately, each against its own limit. */
export type RouteClass =
  | "tokens"
  | "shareLookup"
  | "reads"
  | "assetReads"
  | "writes"
  | "uploads"
  | "reports";

const MINUTE = 60_000;

/**
 * What each class may do per client address per minute.
 *
 * Minting and share-code lookups are the tight ones: minting makes an identity
 * out of nothing, and a share code is a 40-bit capability, so lookups are the
 * only way to guess one. Asset reads are loose because a page of tiles fetches
 * one image per tile.
 *
 * The web app renders public pages on its own server, so those reads reach
 * this API from the web server's address. Run it behind the same proxy setting
 * as the browser traffic, or keep the read limits well above one page's worth.
 */
export const DEFAULT_RATE_LIMITS: Record<RouteClass, RateLimit> = {
  tokens: { limit: 10, windowMs: MINUTE },
  shareLookup: { limit: 60, windowMs: MINUTE },
  reads: { limit: 120, windowMs: MINUTE },
  assetReads: { limit: 600, windowMs: MINUTE },
  writes: { limit: 120, windowMs: MINUTE },
  uploads: { limit: 30, windowMs: MINUTE },
  reports: { limit: 10, windowMs: MINUTE },
};

/** Which routes belong to which class. A route not listed here is not limited. */
const LIMITED_ROUTES: readonly { class: RouteClass; method: string; path: string }[] = [
  { class: "tokens", method: "POST", path: "/tokens" },
  { class: "shareLookup", method: "GET", path: "/shares/:code" },
  { class: "reads", method: "GET", path: "/lists" },
  { class: "reads", method: "GET", path: "/lists/:id" },
  { class: "reads", method: "GET", path: "/browse" },
  { class: "assetReads", method: "GET", path: "/assets/:id" },
  { class: "writes", method: "PUT", path: "/lists/:id" },
  { class: "writes", method: "PATCH", path: "/lists/:id" },
  { class: "writes", method: "DELETE", path: "/lists/:id" },
  { class: "writes", method: "POST", path: "/lists/:id/share" },
  { class: "writes", method: "DELETE", path: "/lists/:id/share" },
  { class: "reports", method: "POST", path: "/reports" },
  { class: "uploads", method: "POST", path: "/assets" },
];

export interface RateLimitSettings {
  limits?: Partial<Record<RouteClass, RateLimit>>;
  /** How many reverse proxies sit in front; see `clientAddress`. Default 0. */
  trustedProxyHops?: number;
  clock: () => number;
}

/**
 * Registers the limiters on an app. Call it after CORS, so a 429 still carries
 * the headers a browser needs to read it, and before the routes.
 */
export function applyRateLimits(
  app: { on: (method: string, path: string, ...handlers: MiddlewareHandler[]) => unknown },
  settings: RateLimitSettings,
): void {
  const hops = settings.trustedProxyHops ?? 0;
  const limiters = new Map<RouteClass, Limiter>();
  for (const name of Object.keys(DEFAULT_RATE_LIMITS) as RouteClass[]) {
    limiters.set(
      name,
      createLimiter(settings.limits?.[name] ?? DEFAULT_RATE_LIMITS[name], settings.clock),
    );
  }

  for (const route of LIMITED_ROUTES) {
    app.on(
      route.method,
      route.path,
      rateLimit(limiters.get(route.class)!, (c) => clientAddress(c, hops)),
    );
  }
}
