import { createTierList, reduce, type TierList } from "@tl/core";
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
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

function doc(id: string, title: string, categoryId: string | null): TierList {
  const base = createTierList({ id, now: NOW, title });
  return reduce(base, { type: "meta/set", patch: { categoryId } }, NOW);
}

/** Creates a list and shares it, optionally opting into being listed. */
async function publish(
  token: string,
  id: string,
  title: string,
  categoryId: string | null,
  listed?: boolean,
): Promise<string> {
  const put = await app.request(`/lists/${id}`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ document: doc(id, title, categoryId) }),
  });
  expect(put.status).toBe(201);

  const res = await app.request(`/lists/${id}/share`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify(listed === undefined ? {} : { listed }),
  });
  return ((await res.json()) as { code: string }).code;
}

async function browse(query = ""): Promise<{ code: string; title: string; categoryId: string | null }[]> {
  const res = await app.request(`/browse${query}`);
  expect(res.status).toBe(200);
  return ((await res.json()) as { results: { code: string; title: string; categoryId: string | null }[] })
    .results;
}

describe("GET /browse", () => {
  /**
   * Holding a link and being indexed are different offers. An author who sent
   * a link to two friends has not asked to appear on a public page.
   */
  it("shows nothing that was not opted in", async () => {
    const token = await mint();
    await publish(token, "unlisted", "Quiet", "games");
    expect(await browse()).toEqual([]);
  });

  it("shows a share whose author opted in", async () => {
    const token = await mint();
    const code = await publish(token, "listed", "Loud", "games", true);

    const results = await browse();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ code, title: "Loud", categoryId: "games" });
  });

  it("filters by category, and an unknown one is empty rather than everything", async () => {
    const token = await mint();
    await publish(token, "a", "Souls", "games", true);
    await publish(token, "b", "Ramen", "food", true);

    expect((await browse("?category=games")).map((r) => r.title)).toEqual(["Souls"]);
    expect((await browse("?category=food")).map((r) => r.title)).toEqual(["Ramen"]);
    expect(await browse("?category=nonsense")).toEqual([]);
  });

  it("matches a title case-insensitively, on a substring", async () => {
    const token = await mint();
    await publish(token, "a", "Best Ramen Ever", "food", true);
    await publish(token, "b", "Udon", "food", true);

    expect((await browse("?q=ramen")).map((r) => r.title)).toEqual(["Best Ramen Ever"]);
    expect((await browse("?q=RAMEN")).map((r) => r.title)).toEqual(["Best Ramen Ever"]);
    expect(await browse("?q=pizza")).toEqual([]);
  });

  /**
   * The wildcards are parameterised, so a `%` the user typed is matched
   * literally rather than widening their own search into "everything".
   */
  it("treats a wildcard character as text, not as a wildcard", async () => {
    const token = await mint();
    await publish(token, "a", "Plain", "food", true);
    await publish(token, "b", "100% Beef", "food", true);

    expect((await browse("?q=%25")).map((r) => r.title)).toEqual(["100% Beef"]);
  });

  it("combines a category and a query", async () => {
    const token = await mint();
    await publish(token, "a", "Ramen", "food", true);
    await publish(token, "b", "Ramen", "games", true);

    expect(await browse("?category=food&q=ramen")).toHaveLength(1);
  });

  it("caps the limit, and takes a smaller one", async () => {
    const token = await mint();
    for (let i = 0; i < 5; i++) await publish(token, `l${i}`, `List ${i}`, "games", true);

    expect(await browse("?limit=2")).toHaveLength(2);
    // Beyond the ceiling is clamped, not honoured, and not an error.
    expect((await browse("?limit=99999")).length).toBe(5);
    // Nonsense falls back to the default rather than to zero.
    expect((await browse("?limit=abc")).length).toBe(5);
  });

  it("never returns a document — browsing is not reading", async () => {
    const token = await mint();
    await publish(token, "a", "Loud", "games", true);
    const res = await app.request("/browse");
    const body = (await res.json()) as { results: Record<string, unknown>[] };
    expect(Object.keys(body.results[0]!).sort()).toEqual([
      "categoryId",
      "code",
      "ogAssetId",
      "title",
      "updatedAt",
    ]);
  });

  it("needs no token", async () => {
    const token = await mint();
    await publish(token, "a", "Loud", "games", true);
    const res = await app.request("/browse");
    expect(res.status).toBe(200);
  });
});

describe("listing is opt-in and reversible", () => {
  it("leaves listing alone when a later share does not mention it", async () => {
    const token = await mint();
    await publish(token, "a", "Loud", "games", true);

    // A second share, asking only for the link.
    await app.request("/lists/a/share", {
      method: "POST",
      headers: auth(token),
      body: "{}",
    });
    expect(await browse()).toHaveLength(1);
  });

  it("unlists when asked", async () => {
    const token = await mint();
    await publish(token, "a", "Loud", "games", true);

    const res = await app.request("/lists/a/share", {
      method: "POST",
      headers: auth(token),
      body: JSON.stringify({ listed: false }),
    });
    expect(((await res.json()) as { listed: boolean }).listed).toBe(false);
    expect(await browse()).toEqual([]);
  });

  it("reports the listing state on the share read", async () => {
    const token = await mint();
    const code = await publish(token, "a", "Loud", "games", true);
    const res = await app.request(`/shares/${code}`);
    expect(((await res.json()) as { listed: boolean }).listed).toBe(true);
  });

  it("refuses to list a list the caller does not own", async () => {
    const owner = await mint();
    const stranger = await mint();
    await publish(owner, "a", "Loud", "games");

    const res = await app.request("/lists/a/share", {
      method: "POST",
      headers: auth(stranger),
      body: JSON.stringify({ listed: true }),
    });
    expect(res.status).toBe(404);
    expect(await browse()).toEqual([]);
  });
});
