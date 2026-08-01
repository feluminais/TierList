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
