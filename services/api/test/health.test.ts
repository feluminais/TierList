import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";

describe("GET /health", () => {
  it("returns ok", async () => {
    const app = buildApp();
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });

  it("returns 404 for an unknown route", async () => {
    const app = buildApp();
    const res = await app.request("/nope");
    expect(res.status).toBe(404);
  });
});

describe("CORS", () => {
  it("allows a cross-origin GET of an asset", async () => {
    const app = buildApp();
    const res = await app.request("/health", {
      headers: { origin: "http://localhost:3000" },
    });
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("answers a preflight", async () => {
    const app = buildApp();
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });
    expect(res.status).toBeLessThan(300);
    expect(res.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "authorization",
    );
  });
});
