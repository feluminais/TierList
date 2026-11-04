import { createTierList } from "@tl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createRepository, type Repository } from "../src/repository";
import { createMemoryStore } from "../src/store";
import { createTestDb, type TestDb } from "./helpers/pglite";

const NOW = "2026-08-01T12:00:00.000Z";

let ctx: TestDb;
let repository: Repository;
let app: ReturnType<typeof buildApp>;
let code: string;
let owner: string;

beforeEach(async () => {
  ctx = await createTestDb();
  repository = createRepository(ctx.db);
  // Each stamp is a second later, so "oldest first" is decided by the clock.
  let stamp = Date.parse(NOW);
  app = buildApp({ repository, store: createMemoryStore(), now: () => new Date((stamp += 1000)) });

  owner = ((await (await app.request("/tokens", { method: "POST" })).json()) as { token: string })
    .token;
  const headers = { "content-type": "application/json", authorization: `Bearer ${owner}` };
  await app.request("/lists/list-1", {
    method: "PUT",
    headers,
    body: JSON.stringify({ document: createTierList({ id: "list-1", now: NOW }) }),
  });
  const shared = await app.request("/lists/list-1/share", { method: "POST", headers, body: "{}" });
  code = ((await shared.json()) as { code: string }).code;
});

afterEach(async () => {
  await ctx.close();
});

const report = (body: unknown, raw = false) =>
  app.request("/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ? (body as string) : JSON.stringify(body),
  });

describe("POST /reports", () => {
  it("records a report against a share, without a token", async () => {
    const res = await report({ code, reason: "abuse", note: "slurs in the title" });
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };

    const rows = await repository.listReports({ open: true });
    expect(rows).toEqual([
      expect.objectContaining({ id, shareCode: code, reason: "abuse", note: "slurs in the title" }),
    ]);
    expect(rows[0]?.resolvedAt).toBeNull();
  });

  it("accepts a report without a note", async () => {
    expect((await report({ code, reason: "spam" })).status).toBe(201);
    expect((await repository.listReports({ open: true }))[0]?.note).toBeNull();
  });

  it.each(["illegal", "abuse", "copyright", "spam", "other"])("accepts the reason %s", async (reason) => {
    expect((await report({ code, reason })).status).toBe(201);
  });

  it("refuses a reason it does not know", async () => {
    expect((await report({ code, reason: "boring" })).status).toBe(400);
    expect((await report({ code })).status).toBe(400);
    expect((await report({ code, reason: 7 })).status).toBe(400);
  });

  it("refuses a note that is not text or is too long", async () => {
    expect((await report({ code, reason: "other", note: 5 })).status).toBe(400);
    expect((await report({ code, reason: "other", note: "x".repeat(501) })).status).toBe(400);
    expect((await report({ code, reason: "other", note: "x".repeat(500) })).status).toBe(201);
  });

  it("answers 404 for a code that names no share, or could not have been issued", async () => {
    expect((await report({ code: "00000000", reason: "spam" })).status).toBe(404);
    expect((await report({ code: "not a code", reason: "spam" })).status).toBe(404);
    expect((await report({ code: 12, reason: "spam" })).status).toBe(400);
    expect(await repository.listReports({ open: true })).toHaveLength(0);
  });

  it("refuses a body that is not JSON", async () => {
    expect((await report("{nope", true)).status).toBe(400);
  });

  it("refuses an oversized body before reading it", async () => {
    expect((await report({ code, reason: "other", note: "x".repeat(40_000) })).status).toBe(413);
  });

  it("is rate-limited on its own class", async () => {
    const limited = buildApp(
      { repository, store: createMemoryStore() },
      { rateLimits: { reports: { limit: 2, windowMs: 60_000 } } },
    );
    const send = () =>
      limited.request("/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, reason: "spam" }),
      });
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
  });

  it("is removed with the share it was about", async () => {
    await report({ code, reason: "spam" });
    const headers = { authorization: `Bearer ${owner}` };
    expect((await app.request("/lists/list-1/share", { method: "DELETE", headers })).status).toBe(204);
    expect(await repository.listReports({})).toHaveLength(0);
  });
});

describe("report handling in the repository", () => {
  it("lists open reports oldest first, and resolving one takes it off that list", async () => {
    await report({ code, reason: "spam" });
    await report({ code, reason: "abuse" });
    const open = await repository.listReports({ open: true });
    expect(open.map((r) => r.reason)).toEqual(["spam", "abuse"]);

    expect(await repository.resolveReport(open[0]!.id, new Date(NOW))).toBe(true);
    expect((await repository.listReports({ open: true })).map((r) => r.reason)).toEqual(["abuse"]);
    expect(await repository.listReports({})).toHaveLength(2);
  });

  it("reports false for a report that is not there", async () => {
    expect(await repository.resolveReport("nope", new Date(NOW))).toBe(false);
  });
});
