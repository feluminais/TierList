import { Hono } from "hono";
import { createRoutes, type RouteDeps } from "./routes";

export function buildApp(deps?: RouteDeps) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  if (deps) app.route("/", createRoutes(deps));

  return app;
}
