import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRoutes, type RouteDeps } from "./routes";

export interface AppOptions {
  /**
   * The browser origins allowed to call this API, such as
   * `https://tierlist.example`. When omitted, every origin is allowed, which
   * suits tests and the local scratch API and nothing else; the production
   * entry point refuses to start without a list.
   */
  allowedOrigins?: readonly string[];
}

export function buildApp(deps?: RouteDeps, options: AppOptions = {}) {
  const app = new Hono();

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

  app.get("/health", (c) => c.json({ status: "ok" }));

  if (deps) app.route("/", createRoutes(deps));

  return app;
}
