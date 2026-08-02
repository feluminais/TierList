import { createTierList, reduce } from "@tl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createRepository } from "../src/repository";
import { createMemoryStore } from "../src/store";
import { createTestDb, type TestDb } from "./helpers/pglite";

const NOW = "2026-08-01T12:00:00.000Z";

let ctx: TestDb;
let app: ReturnType<typeof buildApp>;
// Writes are scoped to a device token; these tests are about the routes
// themselves, so they all speak as one owner. Ownership is exercised in
// ownership.test.ts.
let token: string;

beforeEach(async () => {
  ctx = await createTestDb();
  app = buildApp({ repository: createRepository(ctx.db), store: createMemoryStore() });
  const minted = await app.request("/tokens", { method: "POST" });
  token = ((await minted.json()) as { token: string }).token;
});

afterEach(async () => {
  await ctx.close();
});

function headers() {
  return {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  };
}

async function put(doc: ReturnType<typeof createTierList>) {
  return app.request(`/lists/${doc.id}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify({ document: doc }),
  });
}

describe("PUT /lists/:id", () => {
  it("creates a document and echoes its revision", async () => {
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    const res = await put(doc);

    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({
      id: "list-1",
      revision: 0,
    });
  });

  it("returns 409 when the id already exists", async () => {
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    expect((await put(doc)).status).toBe(201);

    const second = createTierList({
      id: "list-1",
      now: NOW,
      title: "Overwritten",
    });
    const res = await put(second);
    expect(res.status).toBe(409);

    const loaded = await app.request("/lists/list-1");
    await expect(loaded.json()).resolves.toMatchObject({
      document: { title: "Ramen" },
    });
  });

  it("rejects a body that is not a tier list", async () => {
    const res = await app.request("/lists/list-1", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ document: { nope: true } }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a document whose id does not match the url", async () => {
    const doc = createTierList({ id: "other", now: NOW });
    const res = await app.request("/lists/list-1", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ document: doc }),
    });
    expect(res.status).toBe(400);
  });
});

/**
 * Several document fields are projected into typed database columns. A value
 * of the wrong shape is a client error, and has to be answered as one — a
 * server error is the signal reserved for this service actually being broken,
 * and blunting it would hide a real outage.
 *
 * The cases are the ones that reach a column: the two timestamps, the title,
 * and the revision. Structural rules are covered exhaustively in @tl/core.
 */
describe("write routes: malformed documents", () => {
  const cases: { name: string; patch: Record<string, unknown> }[] = [
    { name: "a createdAt that is not a date", patch: { createdAt: "not-a-date" } },
    { name: "an updatedAt that is not a date", patch: { updatedAt: "" } },
    { name: "a title that is not a string", patch: { title: { evil: true } } },
    { name: "a revision that is not a number", patch: { revision: "zero" } },
    { name: "rows that are not an array", patch: { rows: "none" } },
    { name: "a placement naming no item", patch: { placements: [{ itemId: "ghost", rowId: null, index: 0 }] } },
  ];

  it.each(cases)("answers 400, not 500, for $name", async ({ patch }) => {
    const doc = { ...createTierList({ id: "list-1", now: NOW }), ...patch };
    const res = await app.request("/lists/list-1", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ document: doc }),
    });
    expect(res.status).toBe(400);
  });

  it("names what was wrong, so a client can act on the answer", async () => {
    const doc = { ...createTierList({ id: "list-1", now: NOW }), createdAt: "not-a-date" };
    const res = await app.request("/lists/list-1", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ document: doc }),
    });
    const body = (await res.json()) as { problems?: string[] };
    expect(body.problems?.join("; ")).toMatch(/createdAt/);
  });

  it("stores nothing when it refuses a document", async () => {
    const doc = { ...createTierList({ id: "list-1", now: NOW }), title: 7 };
    await app.request("/lists/list-1", {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify({ document: doc }),
    });
    expect((await app.request("/lists/list-1")).status).toBe(404);
  });

  it("answers 400 on PATCH as well as PUT", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    await put(doc);

    const res = await app.request("/lists/list-1", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        document: { ...doc, revision: 1, updatedAt: "whenever" },
        expectedRevision: 0,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /lists/:id", () => {
  it("returns a stored document", async () => {
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    await put(doc);

    const res = await app.request("/lists/list-1");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ document: doc });
  });

  it("returns 404 for an unknown id", async () => {
    const res = await app.request("/lists/nope");
    expect(res.status).toBe(404);
  });
});

describe("PATCH /lists/:id", () => {
  it("applies an update when the expected revision matches", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    await put(doc);

    const next = reduce(
      doc,
      { type: "meta/set", patch: { title: "Ramen" } },
      NOW,
    );
    const res = await app.request("/lists/list-1", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ document: next, expectedRevision: 0 }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ revision: 1 });
  });

  it("returns 409 when the expected revision is stale", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    await put(doc);

    const a = reduce(doc, { type: "meta/set", patch: { title: "A" } }, NOW);
    await app.request("/lists/list-1", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ document: a, expectedRevision: 0 }),
    });

    const b = reduce(doc, { type: "meta/set", patch: { title: "B" } }, NOW);
    const res = await app.request("/lists/list-1", {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ document: b, expectedRevision: 0 }),
    });

    expect(res.status).toBe(409);
  });
});
