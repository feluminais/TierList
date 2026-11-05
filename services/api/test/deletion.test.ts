import { createTierList, reduce, type TierList } from "@tl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createRepository } from "../src/repository";
import { createMemoryStore, type ObjectStore } from "../src/store";
import { pngBytes } from "./helpers/images";
import { createTestDb, type TestDb } from "./helpers/pglite";

const NOW = "2026-08-01T12:00:00.000Z";

let ctx: TestDb;
let store: ObjectStore;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  ctx = await createTestDb();
  store = createMemoryStore();
  // No grace here: these tests are about which images are unreferenced, and a
  // list is deleted straight after its images were uploaded.
  app = buildApp({ repository: createRepository(ctx.db), store, assetGraceMs: 0 });
});

afterEach(async () => {
  await ctx.close();
});

async function mint(): Promise<string> {
  const res = await app.request("/tokens", { method: "POST" });
  return ((await res.json()) as { token: string }).token;
}

const json = (token: string) => ({
  "content-type": "application/json",
  authorization: `Bearer ${token}`,
});

async function upload(token: string, size: number): Promise<{ id: string }> {
  const res = await app.request("/assets", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: pngBytes(size, size),
  });
  expect([200, 201]).toContain(res.status);
  return (await res.json()) as { id: string };
}

function docWith(id: string, assetIds: string[]): TierList {
  let doc = createTierList({ id, now: NOW });
  assetIds.forEach((assetId, n) => {
    doc = reduce(doc, { type: "item/addImage", id: `${id}-i${n}`, assetId }, NOW);
  });
  return doc;
}

async function put(token: string, doc: TierList) {
  const res = await app.request(`/lists/${doc.id}`, {
    method: "PUT",
    headers: json(token),
    body: JSON.stringify({ document: doc }),
  });
  expect(res.status).toBe(201);
}

async function share(token: string, listId: string, body: object = {}) {
  const res = await app.request(`/lists/${listId}/share`, {
    method: "POST",
    headers: json(token),
    body: JSON.stringify(body),
  });
  return (await res.json()) as { code: string };
}

const del = (token: string | null, path: string) =>
  app.request(path, { method: "DELETE", headers: token ? json(token) : {} });

const assetExists = async (id: string) => (await app.request(`/assets/${id}`)).status === 200;

describe("DELETE /lists/:id", () => {
  it("removes the list, so it can no longer be read", async () => {
    const token = await mint();
    await put(token, docWith("list-1", []));

    expect((await del(token, "/lists/list-1")).status).toBe(204);
    expect((await app.request("/lists/list-1")).status).toBe(404);
    const mine = (await (await app.request("/lists", { headers: json(token) })).json()) as {
      lists: unknown[];
    };
    expect(mine.lists).toHaveLength(0);
  });

  it("withdraws the list's share and its listing", async () => {
    const token = await mint();
    await put(token, docWith("list-1", []));
    const { code } = await share(token, "list-1", { listed: true });
    const listedBefore = (await (await app.request("/browse")).json()) as { results: unknown[] };
    expect(listedBefore.results).toHaveLength(1);

    await del(token, "/lists/list-1");

    expect((await app.request(`/shares/${code}`)).status).toBe(404);
    const browse = (await (await app.request("/browse")).json()) as { results: unknown[] };
    expect(browse.results).toHaveLength(0);
  });

  it("answers 404 for an id that is not there, and again for one already deleted", async () => {
    const token = await mint();
    expect((await del(token, "/lists/nope")).status).toBe(404);
    await put(token, docWith("list-1", []));
    expect((await del(token, "/lists/list-1")).status).toBe(204);
    expect((await del(token, "/lists/list-1")).status).toBe(404);
  });

  it("answers a stranger exactly as it answers a missing id, and changes nothing", async () => {
    const owner = await mint();
    const stranger = await mint();
    await put(owner, docWith("list-1", []));

    expect((await del(stranger, "/lists/list-1")).status).toBe(404);
    expect((await app.request("/lists/list-1")).status).toBe(200);
  });

  it("needs a token", async () => {
    const token = await mint();
    await put(token, docWith("list-1", []));
    expect((await del(null, "/lists/list-1")).status).toBe(401);
    expect((await app.request("/lists/list-1")).status).toBe(200);
  });

  describe("the images the list used", () => {
    it("removes an image only this list used, from the database and from the store", async () => {
      const token = await mint();
      const a = await upload(token, 4);
      await put(token, docWith("list-1", [a.id]));
      const row = await createRepository(ctx.db).findAsset(a.id);

      await del(token, "/lists/list-1");

      expect(await assetExists(a.id)).toBe(false);
      expect(await store.get(row!.storageKey)).toBeNull();
    });

    it("keeps an image another list of the same owner still uses", async () => {
      const token = await mint();
      const shared = await upload(token, 4);
      const only = await upload(token, 5);
      await put(token, docWith("list-1", [shared.id, only.id]));
      await put(token, docWith("list-2", [shared.id]));

      await del(token, "/lists/list-1");

      expect(await assetExists(shared.id)).toBe(true);
      expect(await assetExists(only.id)).toBe(false);
    });

    it("keeps an image another owner's copy of the list still uses", async () => {
      const author = await mint();
      const filler = await mint();
      const img = await upload(author, 4);
      const template = docWith("template", [img.id]);
      await put(author, template);
      // A fill is a copy of the template held by someone else.
      await put(filler, { ...template, id: "fill" });

      await del(author, "/lists/template");

      expect(await assetExists(img.id)).toBe(true);
    });

    it("removes the share's preview image with the list", async () => {
      const token = await mint();
      const preview = await upload(token, 6);
      await put(token, docWith("list-1", []));
      await share(token, "list-1", { ogAssetId: preview.id });

      await del(token, "/lists/list-1");

      expect(await assetExists(preview.id)).toBe(false);
    });

    it("keeps a preview image another share still uses", async () => {
      const token = await mint();
      const preview = await upload(token, 6);
      await put(token, docWith("list-1", []));
      await put(token, docWith("list-2", []));
      await share(token, "list-1", { ogAssetId: preview.id });
      await share(token, "list-2", { ogAssetId: preview.id });

      await del(token, "/lists/list-1");

      expect(await assetExists(preview.id)).toBe(true);
    });

    it("never removes an image that belongs to another owner", async () => {
      const author = await mint();
      const filler = await mint();
      const authors = await upload(author, 4);
      await put(author, docWith("template", [authors.id]));
      await put(filler, { ...docWith("fill", [authors.id]) });

      // The filler deletes their copy; the author's image is not theirs to remove.
      await del(filler, "/lists/fill");

      expect(await assetExists(authors.id)).toBe(true);
    });

    it("does not remove an image another owner's copy referenced when the copy goes later", async () => {
      // The author's list goes first and the image stays, because the fill still
      // refers to it. When the filler's copy then goes, nothing refers to the
      // image any more, but it is the author's and is not the filler's to remove.
      const author = await mint();
      const filler = await mint();
      const img = await upload(author, 4);
      const template = docWith("template", [img.id]);
      await put(author, template);
      await put(filler, { ...template, id: "fill" });

      await del(author, "/lists/template");
      expect(await assetExists(img.id)).toBe(true);
      await del(filler, "/lists/fill");

      expect(await assetExists(img.id)).toBe(true);
    });

    it("ignores ids in a document that no upload made", async () => {
      const token = await mint();
      const real = await upload(token, 4);
      await put(token, docWith("list-1", ["not-an-asset", real.id, "also-not"]));
      expect((await del(token, "/lists/list-1")).status).toBe(204);
      expect(await assetExists(real.id)).toBe(false);
    });

    it("still deletes the list when the store cannot remove the bytes", async () => {
      const failing: ObjectStore = {
        ...store,
        delete: async () => {
          throw new Error("disk gone");
        },
      };
      const failingApp = buildApp({
        repository: createRepository(ctx.db),
        store: failing,
        assetGraceMs: 0,
      });
      const token = ((await (await failingApp.request("/tokens", { method: "POST" })).json()) as {
        token: string;
      }).token;
      const up = await failingApp.request("/assets", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: pngBytes(4, 4),
      });
      const { id } = (await up.json()) as { id: string };
      const doc = docWith("list-1", [id]);
      await failingApp.request("/lists/list-1", {
        method: "PUT",
        headers: json(token),
        body: JSON.stringify({ document: doc }),
      });

      const res = await failingApp.request("/lists/list-1", { method: "DELETE", headers: json(token) });

      // The rows are the truth; bytes left behind are an invisible orphan.
      expect(res.status).toBe(204);
      expect((await failingApp.request("/lists/list-1")).status).toBe(404);
    });
  });
});

describe("an image used recently", () => {
  // A document the server has not seen yet may be about to refer to an image the
  // owner has just uploaded or uploaded again, so a deletion leaves it alone.
  const MINUTE = 60_000;
  let clock: number;
  let graceApp: ReturnType<typeof buildApp>;

  beforeEach(() => {
    clock = Date.parse(NOW);
    graceApp = buildApp(
      { repository: createRepository(ctx.db), store, now: () => new Date(clock) },
      {},
    );
  });

  const send = (token: string | null, path: string, init: RequestInit = {}) =>
    graceApp.request(path, {
      ...init,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json" },
    });

  async function graceMint() {
    return ((await (await graceApp.request("/tokens", { method: "POST" })).json()) as { token: string }).token;
  }
  async function graceUpload(token: string, size: number) {
    const res = await graceApp.request("/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: pngBytes(size, size),
    });
    return (await res.json()) as { id: string };
  }
  async function gracePut(token: string, doc: TierList) {
    expect((await send(token, `/lists/${doc.id}`, { method: "PUT", body: JSON.stringify({ document: doc }) })).status).toBe(201);
  }
  const graceExists = async (id: string) => (await graceApp.request(`/assets/${id}`)).status === 200;

  it("is kept when its list is deleted soon after the upload", async () => {
    const token = await graceMint();
    const img = await graceUpload(token, 4);
    await gracePut(token, docWith("list-1", [img.id]));

    clock += 5 * MINUTE;
    expect((await send(token, "/lists/list-1", { method: "DELETE" })).status).toBe(204);

    expect(await graceExists(img.id)).toBe(true);
  });

  it("goes with its list once it has been unused for the whole grace period", async () => {
    const token = await graceMint();
    const img = await graceUpload(token, 4);
    await gracePut(token, docWith("list-1", [img.id]));

    clock += 16 * MINUTE;
    await send(token, "/lists/list-1", { method: "DELETE" });

    expect(await graceExists(img.id)).toBe(false);
  });

  it("is kept when the same bytes were uploaded again, which makes it recent again", async () => {
    const token = await graceMint();
    const img = await graceUpload(token, 4);
    await gracePut(token, docWith("list-1", [img.id]));

    clock += 60 * MINUTE;
    const again = await graceUpload(token, 4);
    expect(again.id).toBe(img.id);

    clock += MINUTE;
    await send(token, "/lists/list-1", { method: "DELETE" });
    expect(await graceExists(img.id)).toBe(true);

    // Left alone for the whole grace period afterwards, a later deletion of a
    // list that used it can take it.
    await gracePut(token, docWith("list-2", [img.id]));
    clock += 16 * MINUTE;
    await send(token, "/lists/list-2", { method: "DELETE" });
    expect(await graceExists(img.id)).toBe(false);
  });
});

describe("DELETE /lists/:id/share", () => {
  it("withdraws the code and the listing, and leaves the list", async () => {
    const token = await mint();
    await put(token, docWith("list-1", []));
    const { code } = await share(token, "list-1", { listed: true });
    const listedBefore = (await (await app.request("/browse")).json()) as { results: unknown[] };
    expect(listedBefore.results).toHaveLength(1);

    expect((await del(token, "/lists/list-1/share")).status).toBe(204);

    expect((await app.request(`/shares/${code}`)).status).toBe(404);
    const browse = (await (await app.request("/browse")).json()) as { results: unknown[] };
    expect(browse.results).toHaveLength(0);
    expect((await app.request("/lists/list-1")).status).toBe(200);
  });

  it("lets the list be shared again, under a new code", async () => {
    const token = await mint();
    await put(token, docWith("list-1", []));
    const first = await share(token, "list-1");
    await del(token, "/lists/list-1/share");
    const second = await share(token, "list-1");

    expect(second.code).not.toBe(first.code);
    expect((await app.request(`/shares/${first.code}`)).status).toBe(404);
    expect((await app.request(`/shares/${second.code}`)).status).toBe(200);
  });

  it("answers 404 when there is no share, or the list is someone else's", async () => {
    const owner = await mint();
    const stranger = await mint();
    await put(owner, docWith("list-1", []));
    expect((await del(owner, "/lists/list-1/share")).status).toBe(404);

    const { code } = await share(owner, "list-1");
    expect((await del(stranger, "/lists/list-1/share")).status).toBe(404);
    expect((await app.request(`/shares/${code}`)).status).toBe(200);
  });

  it("needs a token", async () => {
    const token = await mint();
    await put(token, docWith("list-1", []));
    await share(token, "list-1");
    expect((await del(null, "/lists/list-1/share")).status).toBe(401);
  });
});
