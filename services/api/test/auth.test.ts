import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createRepository } from "../src/repository";
import { createTestDb, type TestDb } from "./helpers/pglite";

let ctx: TestDb;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  ctx = await createTestDb();
  app = buildApp({ repository: createRepository(ctx.db) });
});

afterEach(async () => {
  await ctx.close();
});

describe("POST /tokens", () => {
  it("mints a token and its id", async () => {
    const res = await app.request("/tokens", { method: "POST" });
    expect(res.status).toBe(201);

    const body = (await res.json()) as { token: string; id: string };
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43,64}$/);
    expect(body.id).toBeTruthy();
  });

  it("mints a distinct token each time", async () => {
    const a = (await (
      await app.request("/tokens", { method: "POST" })
    ).json()) as { token: string };
    const b = (await (
      await app.request("/tokens", { method: "POST" })
    ).json()) as { token: string };
    expect(a.token).not.toBe(b.token);
  });

  it("never stores the raw token", async () => {
    const body = (await (
      await app.request("/tokens", { method: "POST" })
    ).json()) as { token: string };
    const rows = await ctx.db.execute("select token_hash from device_tokens");
    expect(rows.rows).toHaveLength(1);
    expect(JSON.stringify(rows.rows)).not.toContain(body.token);
  });
});
