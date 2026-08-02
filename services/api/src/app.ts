import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRoutes, type RouteDeps } from "./routes";

export function buildApp(deps?: RouteDeps) {
  const app = new Hono();

  /**
   * Applied to everything, before any route.
   *
   * Reads are public by design, and the editor fetches an asset's bytes from a
   * different origin than the page, which a browser refuses without these
   * headers.
   *
   * The origin is open because there is no deploy and no cookie-based session
   * to protect: authentication is a bearer token the client holds
   * deliberately, so a permissive origin grants a hostile page nothing it
   * could not do with `fetch` and no token. **Narrow this at deploy time**,
   * when there is a real origin to name.
   *
   * No `allowHeaders` option. Given none, hono reflects back whatever the
   * preflight's `Access-Control-Request-Headers` asked for, so `authorization`
   * clears preflight without being named — and a hard-coded allowlist would be
   * one more place to update the day a header is added.
   */
  app.use("*", cors());

  app.get("/health", (c) => c.json({ status: "ok" }));

  if (deps) app.route("/", createRoutes(deps));

  return app;
}
