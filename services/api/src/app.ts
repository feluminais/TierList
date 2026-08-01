import { Hono } from "hono";

export function buildApp() {
  const app = new Hono();

  app.get("/health", (c) => c.json({ status: "ok" }));

  return app;
}
