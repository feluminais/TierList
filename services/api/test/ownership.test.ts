import { createTierList, reduce } from "@tl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createRepository } from "../src/repository";
import { createMemoryStore } from "../src/store";
import { createTestDb, type TestDb } from "./helpers/pglite";

const NOW = "2026-08-01T12:00:00.000Z";

let ctx: TestDb;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  ctx = await createTestDb();
  app = buildApp({ repository: createRepository(ctx.db), store: createMemoryStore() });
});

afterEach(async () => {
  await ctx.close();
});

async function mint(): Promise<string> {
  const res = await app.request("/tokens", { method: "POST" });
  return ((await res.json()) as { token: string }).token;
}

function auth(token: string) {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

describe("ownership", () => {
  it("records the caller as owner on create", async () => {
    const token = await mint();
    const doc = createTierList({ id: "list-1", now: NOW });

    const res = await app.request("/lists/list-1", {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ document: doc }),
    });
    expect(res.status).toBe(201);

    const rows = await ctx.db.execute(
      "select owner_id from tier_lists where id = 'list-1'",
    );
    expect(rows.rows[0]).toMatchObject({ owner_id: expect.any(String) });
  });

  it("lets the owner update their own document", async () => {
    const token = await mint();
    const doc = createTierList({ id: "list-1", now: NOW });
    await app.request("/lists/list-1", {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ document: doc }),
    });

    const next = reduce(doc, { type: "meta/set", patch: { title: "Ramen" } }, NOW);
    const res = await app.request("/lists/list-1", {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ document: next, expectedRevision: 0 }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 404, not 403, when a different caller tries to update", async () => {
    const owner = await mint();
    const stranger = await mint();
    const doc = createTierList({ id: "list-1", now: NOW });
    await app.request("/lists/list-1", {
      method: "PUT",
      headers: auth(owner),
      body: JSON.stringify({ document: doc }),
    });

    const next = reduce(
      doc,
      { type: "meta/set", patch: { title: "Hijacked" } },
      NOW,
    );
    const res = await app.request("/lists/list-1", {
      method: "PATCH",
      headers: auth(stranger),
      body: JSON.stringify({ document: next, expectedRevision: 0 }),
    });
    expect(res.status).toBe(404);

    const loaded = await app.request("/lists/list-1");
    await expect(loaded.json()).resolves.toMatchObject({
      document: { title: "Untitled tier list" },
    });
  });

  /**
   * The failure this pins is silent: `update`'s where-clause now includes the
   * owner, so a stranger and a stale revision both match zero rows and raise
   * the same RevisionConflictError. If the route collapsed them into 404, a
   * legitimate owner losing a race would be told to stop rather than re-read,
   * and the write would vanish with no error anyone sees.
   */
  it("returns 409, not 404, when the owner's own revision is stale", async () => {
    const token = await mint();
    const doc = createTierList({ id: "list-1", now: NOW });
    await app.request("/lists/list-1", {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ document: doc }),
    });

    const a = reduce(doc, { type: "meta/set", patch: { title: "A" } }, NOW);
    const first = await app.request("/lists/list-1", {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ document: a, expectedRevision: 0 }),
    });
    expect(first.status).toBe(200);

    const b = reduce(doc, { type: "meta/set", patch: { title: "B" } }, NOW);
    const res = await app.request("/lists/list-1", {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ document: b, expectedRevision: 0 }),
    });
    expect(res.status).toBe(409);
  });

  it("keeps reads public", async () => {
    const token = await mint();
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    await app.request("/lists/list-1", {
      method: "PUT",
      headers: auth(token),
      body: JSON.stringify({ document: doc }),
    });

    const res = await app.request("/lists/list-1");
    expect(res.status).toBe(200);
  });

  it("rejects a write with no token", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    const res = await app.request("/lists/list-1", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ document: doc }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a write with an unknown token", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    const res = await app.request("/lists/list-1", {
      method: "PUT",
      headers: auth("A".repeat(43)),
      body: JSON.stringify({ document: doc }),
    });
    expect(res.status).toBe(401);
  });
});

describe("GET /lists", () => {
  it("returns only the caller's documents, newest first", async () => {
    const mine = await mint();
    const theirs = await mint();

    for (const [id, title] of [
      ["a", "A"],
      ["b", "B"],
    ] as const) {
      await app.request(`/lists/${id}`, {
        method: "PUT",
        headers: auth(mine),
        body: JSON.stringify({ document: createTierList({ id, now: NOW, title }) }),
      });
    }
    await app.request("/lists/c", {
      method: "PUT",
      headers: auth(theirs),
      body: JSON.stringify({
        document: createTierList({ id: "c", now: NOW, title: "C" }),
      }),
    });

    const res = await app.request("/lists", { headers: auth(mine) });
    expect(res.status).toBe(200);

    const body = (await res.json()) as { lists: { id: string }[] };
    expect(body.lists.map((l) => l.id).sort()).toEqual(["a", "b"]);
  });

  it("requires a token", async () => {
    expect((await app.request("/lists")).status).toBe(401);
  });
});
