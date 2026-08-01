import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRoutes, type RouteDeps } from "./routes";

export function buildApp(deps?: RouteDeps) {
  const app = new Hono();

  /**
   * Applied to everything, before any route.
   *
   * Reads are public by design — sharing a list is the product — and the
   * editor fetches an asset's bytes from a different origin than the page,
   * which a browser refuses without these headers. It was invisible until now
   * only because nothing in this repo had ever fetched from a browser: the
   * one end-to-end run that worked wrapped the app in this same middleware
   * from a throwaway script.
   *
   * The origin is open because there is no deploy and no cookie-based session
   * to protect — authentication is a bearer token the client holds
   * deliberately, so a permissive origin grants a hostile page nothing it
   * could not already do with `fetch` and no token. **Narrow this at 1E**,
   * when there is a real origin to name.
   *
   * No `allowHeaders` option: hono's default, when none is given, is to
   * reflect back whatever the preflight's `Access-Control-Request-Headers`
   * asked for (see `hono/dist/middleware/cors`). `authorization` therefore
   * already clears preflight without naming it, and a hard-coded allowlist
   * here would be one more place to remember to update the day a header is
   * added — a thing to maintain for no behaviour it does not already have.
   */
  app.use("*", cors());

  app.get("/health", (c) => c.json({ status: "ok" }));

  if (deps) app.route("/", createRoutes(deps));

  return app;
}
