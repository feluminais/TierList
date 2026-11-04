import { createTierList } from "@tl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { moderate } from "../src/moderation";
import { createRepository, type Repository } from "../src/repository";
import { createMemoryStore } from "../src/store";
import { createTestDb, type TestDb } from "./helpers/pglite";

const NOW = new Date("2026-08-01T12:00:00.000Z");

let ctx: TestDb;
let repository: Repository;
let app: ReturnType<typeof buildApp>;
let code: string;

beforeEach(async () => {
  ctx = await createTestDb();
  repository = createRepository(ctx.db);
  app = buildApp({ repository, store: createMemoryStore() });

  const token = ((await (await app.request("/tokens", { method: "POST" })).json()) as { token: string })
    .token;
  const headers = { "content-type": "application/json", authorization: `Bearer ${token}` };
  await app.request("/lists/list-1", {
    method: "PUT",
    headers,
    body: JSON.stringify({ document: createTierList({ id: "list-1", now: NOW.toISOString() }) }),
  });
  const shared = await app.request("/lists/list-1/share", {
    method: "POST",
    headers,
    body: JSON.stringify({ listed: true }),
  });
  code = ((await shared.json()) as { code: string }).code;
});

afterEach(async () => {
  await ctx.close();
});

const report = (reason: string, note?: string) =>
  app.request("/reports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, reason, note }),
  });

const run = (args: string[]) => moderate(args, repository, () => NOW);

describe("moderate", () => {
  it("lists open reports with their id, code, reason and note", async () => {
    await report("abuse", "bad title");
    const { lines, ok } = await run(["reports"]);
    expect(ok).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(code);
    expect(lines[0]).toContain("abuse");
    expect(lines[0]).toContain("bad title");
  });

  it("says so when there is nothing open", async () => {
    expect((await run(["reports"])).lines).toEqual(["No open reports."]);
  });

  it("lists resolved reports too with --all", async () => {
    await report("spam");
    const [open] = await repository.listReports({ open: true });
    await run(["dismiss", open!.id]);
    expect((await run(["reports"])).lines).toEqual(["No open reports."]);
    expect((await run(["reports", "--all"])).lines).toHaveLength(1);
  });

  it("dismisses a report", async () => {
    await report("spam");
    const [open] = await repository.listReports({ open: true });
    const result = await run(["dismiss", open!.id]);
    expect(result.ok).toBe(true);
    expect(await repository.listReports({ open: true })).toHaveLength(0);
  });

  it("fails on an id that names no report", async () => {
    expect(await run(["dismiss", "nope"])).toMatchObject({ ok: false });
  });

  it("unlists a share: still reachable by link, gone from browse", async () => {
    const result = await run(["unlist", code]);
    expect(result.ok).toBe(true);
    expect((await app.request(`/shares/${code}`)).status).toBe(200);
    const browse = (await (await app.request("/browse")).json()) as { results: unknown[] };
    expect(browse.results).toHaveLength(0);
  });

  it("removes a share, so its link stops working, and its reports with it", async () => {
    await report("illegal");
    const result = await run(["remove", code]);
    expect(result.ok).toBe(true);
    expect((await app.request(`/shares/${code}`)).status).toBe(404);
    expect(await repository.listReports({})).toHaveLength(0);
    // The list itself is the owner's and is not touched.
    expect((await app.request("/lists/list-1")).status).toBe(200);
  });

  it("fails on a code that names no share", async () => {
    expect(await run(["unlist", "00000000"])).toMatchObject({ ok: false });
    expect(await run(["remove", "00000000"])).toMatchObject({ ok: false });
  });

  it("explains itself on an unknown command or missing argument", async () => {
    expect(await run([])).toMatchObject({ ok: false });
    expect(await run(["frobnicate"])).toMatchObject({ ok: false });
    expect(await run(["remove"])).toMatchObject({ ok: false });
  });
});
