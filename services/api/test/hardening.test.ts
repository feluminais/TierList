import { createTierList, reduce, type TierList } from "@tl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createRepository } from "../src/repository";
import { createMemoryStore } from "../src/store";
import { createTestDb, type TestDb } from "./helpers/pglite";

const NOW = "2026-08-01T12:00:00.000Z";
const MiB = 1024 * 1024;

let ctx: TestDb;
let app: ReturnType<typeof buildApp>;
/** The server's clock, moved by hand so write order is deterministic. */
let clock: Date;

beforeEach(async () => {
  ctx = await createTestDb();
  clock = new Date("2026-09-01T10:00:00.000Z");
  app = buildApp({
    repository: createRepository(ctx.db),
    store: createMemoryStore(),
    now: () => clock,
  });
});
afterEach(async () => {
  await ctx.close();
});

async function mint(): Promise<string> {
  const res = await app.request("/tokens", { method: "POST" });
  return ((await res.json()) as { token: string }).token;
}

function auth(token: string) {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function put(token: string, doc: TierList) {
  return app.request(`/lists/${doc.id}`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ document: doc }),
  });
}

function patch(token: string, doc: unknown, expectedRevision: number, id: string) {
  return app.request(`/lists/${id}`, {
    method: "PATCH",
    headers: auth(token),
    body: JSON.stringify({ document: doc, expectedRevision }),
  });
}

describe("request size limits", () => {
  it("refuses a document body past its limit and stores nothing", async () => {
    const token = await mint();
    const doc = createTierList({ id: "list-1", now: NOW });
    const res = await app.request("/lists/list-1", {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ document: doc, padding: "x".repeat(5 * MiB) }),
    });

    expect(res.status).toBe(413);
    expect((await app.request("/lists/list-1")).status).toBe(404);
  });

  it("refuses an oversized share body", async () => {
    const token = await mint();
    await put(token, createTierList({ id: "list-1", now: NOW }));

    const res = await app.request("/lists/list-1/share", {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ listed: true, padding: "x".repeat(32 * 1024) }),
    });
    expect(res.status).toBe(413);
  });

  /**
   * The case a `Content-Length` check cannot see: a chunked upload announces no
   * size. The limit has to count bytes as they stream in and stop reading, so
   * the stream here is far larger than the limit and records how much of it
   * the server actually pulled.
   */
  it("stops reading a chunked upload once it passes the limit", async () => {
    const token = await mint();
    const totalChunks = 50;
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled === totalChunks) return controller.close();
        pulled += 1;
        controller.enqueue(new Uint8Array(MiB));
      },
    });

    const res = await app.request("/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
      body: stream,
      duplex: "half",
    } as RequestInit);

    expect(res.status).toBe(413);
    // Ten mebibytes is the upload limit; well short of the fifty on offer.
    expect(pulled).toBeLessThan(20);
  });
});

/**
 * Browse and "my lists" order by the row's timestamp. It is the server's record
 * of when it stored the row, never the author's own claim, or anyone could pin
 * a list to the top of a public page by dating it in the future.
 */
describe("server-recorded timestamps", () => {
  async function publish(token: string, doc: TierList) {
    expect((await put(token, doc)).status).toBe(201);
    const res = await app.request(`/lists/${doc.id}/share`, {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ listed: true }),
    });
    expect(res.status).toBe(201);
  }

  async function browseTitles(): Promise<{ title: string; updatedAt: string }[]> {
    const res = await app.request("/browse");
    return ((await res.json()) as { results: { title: string; updatedAt: string }[] }).results;
  }

  it("orders browse by when the server stored each list, not by the date a list claims", async () => {
    const token = await mint();
    const first = new Date("2026-09-01T10:00:00.000Z");
    const second = new Date("2026-09-01T11:00:00.000Z");

    clock = first;
    await publish(token, {
      ...createTierList({ id: "boaster", now: NOW, title: "Boaster" }),
      updatedAt: "2999-01-01T00:00:00.000Z",
    });
    clock = second;
    await publish(token, createTierList({ id: "honest", now: NOW, title: "Honest" }));

    const results = await browseTitles();
    expect(results.map((r) => r.title)).toEqual(["Honest", "Boaster"]);
    expect(results.map((r) => r.updatedAt)).toEqual([second.toISOString(), first.toISOString()]);
  });

  it("moves a list forward when it is updated", async () => {
    const token = await mint();
    const a = createTierList({ id: "a", now: NOW, title: "A" });
    clock = new Date("2026-09-01T10:00:00.000Z");
    await publish(token, a);
    clock = new Date("2026-09-01T11:00:00.000Z");
    await publish(token, createTierList({ id: "b", now: NOW, title: "B" }));

    clock = new Date("2026-09-01T12:00:00.000Z");
    const edited = reduce(a, { type: "meta/set", patch: { title: "A2" } }, NOW);
    expect((await patch(token, edited, 0, "a")).status).toBe(200);

    expect((await browseTitles()).map((r) => r.title)).toEqual(["A2", "B"]);
  });
});

/**
 * A write whose response is lost reaches the client as a network failure, and
 * the client sends it again unchanged. By then the server already holds it, so
 * the repeat carries a stale expected revision. Answering that with 409 would
 * stop the client's saving for good over a response that merely went missing.
 */
describe("repeated writes", () => {
  it("answers a repeated PATCH as success", async () => {
    const token = await mint();
    const doc = createTierList({ id: "list-1", now: NOW });
    await put(token, doc);
    const next = reduce(doc, { type: "meta/set", patch: { title: "Ramen" } }, NOW);

    expect((await patch(token, next, 0, "list-1")).status).toBe(200);
    const repeat = await patch(token, next, 0, "list-1");

    expect(repeat.status).toBe(200);
    await expect(repeat.json()).resolves.toEqual({ id: "list-1", revision: next.revision });
  });

  it("matches a repeat whatever order its keys arrive in", async () => {
    const token = await mint();
    const doc = createTierList({ id: "list-1", now: NOW });
    await put(token, doc);
    const next = reduce(doc, { type: "meta/set", patch: { title: "Ramen" } }, NOW);
    await patch(token, next, 0, "list-1");

    const reordered = Object.fromEntries(Object.entries(next).reverse());
    expect((await patch(token, reordered, 0, "list-1")).status).toBe(200);
  });

  it("still answers 409 when the stale write carries different content", async () => {
    const token = await mint();
    const doc = createTierList({ id: "list-1", now: NOW });
    await put(token, doc);
    await patch(token, reduce(doc, { type: "meta/set", patch: { title: "A" } }, NOW), 0, "list-1");

    const other = reduce(doc, { type: "meta/set", patch: { title: "B" } }, NOW);
    expect((await patch(token, other, 0, "list-1")).status).toBe(409);
    const stored = (await (await app.request("/lists/list-1")).json()) as { document: TierList };
    expect(stored.document.title).toBe("A");
  });

  it("answers a repeated create as success", async () => {
    const token = await mint();
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });

    expect((await put(token, doc)).status).toBe(201);
    const repeat = await put(token, doc);
    expect(repeat.status).toBe(201);
    await expect(repeat.json()).resolves.toEqual({ id: "list-1", revision: doc.revision });
  });

  it("refuses a create that collides with different content or another owner", async () => {
    const owner = await mint();
    const stranger = await mint();
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    await put(owner, doc);

    expect((await put(owner, { ...doc, title: "Udon" })).status).toBe(409);
    expect((await put(stranger, doc)).status).toBe(409);
  });
});

describe("CORS origins", () => {
  function preflight(target: ReturnType<typeof buildApp>, origin: string) {
    return target.request("/health", {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "PATCH",
        "access-control-request-headers": "authorization",
      },
    });
  }

  it("names only an allowed origin", async () => {
    const restricted = buildApp(undefined, { allowedOrigins: ["https://tierlist.example"] });

    const allowed = await restricted.request("/health", {
      headers: { origin: "https://tierlist.example" },
    });
    expect(allowed.headers.get("access-control-allow-origin")).toBe("https://tierlist.example");

    const other = await restricted.request("/health", {
      headers: { origin: "https://elsewhere.example" },
    });
    expect(other.headers.get("access-control-allow-origin")).toBe(null);

    const otherPreflight = await preflight(restricted, "https://elsewhere.example");
    expect(otherPreflight.headers.get("access-control-allow-origin")).toBe(null);
  });

  it("answers every origin when none are named", async () => {
    const open = buildApp();
    const res = await open.request("/health", { headers: { origin: "https://anywhere.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
