import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createRepository, type Repository } from "../src/repository";
import { createMemoryStore, type ObjectStore } from "../src/store";
import { createTestDb, type TestDb } from "./helpers/pglite";
import { jpegBytes, pngBytes } from "./helpers/images";

const NOW = new Date("2026-08-01T12:00:00.000Z");

function asset(overrides: Partial<Parameters<Repository["createAsset"]>[0]> = {}) {
  return {
    id: "asset-1",
    ownerId: "owner-1",
    storageKey: "assets/asset-1",
    contentType: "image/png",
    byteSize: 1024,
    width: 100,
    height: 50,
    checksum: "abc123",
    createdAt: NOW,
    ...overrides,
  };
}

describe("asset repository", () => {
  let testDb: TestDb;
  let repository: Repository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repository = createRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("returns a stored asset by id", async () => {
    await repository.createAsset(asset());
    const found = await repository.findAsset("asset-1");
    expect(found).toMatchObject({
      id: "asset-1",
      ownerId: "owner-1",
      storageKey: "assets/asset-1",
      contentType: "image/png",
      width: 100,
      height: 50,
      byteSize: 1024,
    });
    // timestamptz round-trip: this must come back as the same instant, not
    // shifted by the connection's or the server's timezone.
    expect(found?.createdAt).toBeInstanceOf(Date);
    expect(found?.createdAt.getTime()).toBe(NOW.getTime());
  });

  it("returns null for an unknown id", async () => {
    expect(await repository.findAsset("nope")).toBeNull();
  });

  it("finds an owner's asset by checksum", async () => {
    await repository.createAsset(asset());
    const found = await repository.findAssetByChecksum("owner-1", "abc123");
    expect(found?.id).toBe("asset-1");
  });

  // Dedupe is per owner on purpose: sharing bytes across owners would mean one
  // owner's future delete could break another owner's document.
  it("does not find another owner's asset by checksum", async () => {
    await repository.createAsset(asset());
    expect(await repository.findAssetByChecksum("owner-2", "abc123")).toBeNull();
  });

  // Guards against a query that filters by owner alone and happens to return
  // *an* asset of theirs rather than the one with these exact bytes.
  it("does not find the same owner's asset under a different checksum", async () => {
    await repository.createAsset(asset());
    await repository.createAsset(
      asset({ id: "asset-2", storageKey: "assets/asset-2", checksum: "different" }),
    );
    expect(await repository.findAssetByChecksum("owner-1", "not-a-real-checksum")).toBeNull();
    expect((await repository.findAssetByChecksum("owner-1", "different"))?.id).toBe("asset-2");
  });

  it("lets two owners hold identical bytes as separate assets", async () => {
    await repository.createAsset(asset());
    await repository.createAsset(
      asset({ id: "asset-2", ownerId: "owner-2", storageKey: "assets/asset-2" }),
    );
    expect((await repository.findAssetByChecksum("owner-1", "abc123"))?.id).toBe("asset-1");
    expect((await repository.findAssetByChecksum("owner-2", "abc123"))?.id).toBe("asset-2");
  });

  // The unique index on (owner, checksum) is what stands between a raced
  // double-upload and two rows for the same bytes. `createAsset` reports the
  // loss as `false` rather than throwing, so the route can answer the loser
  // with the winner's asset.
  it("reports false, and keeps one row, for a second asset with the same owner and checksum", async () => {
    expect(await repository.createAsset(asset())).toBe(true);
    expect(
      await repository.createAsset(asset({ id: "asset-2", storageKey: "assets/asset-2" })),
    ).toBe(false);

    expect(await repository.findAsset("asset-2")).toBeNull();
    expect((await repository.findAssetByChecksum("owner-1", "abc123"))?.id).toBe("asset-1");
  });
});

describe("POST /assets", () => {
  let testDb: TestDb;
  let store: ObjectStore;
  let app: ReturnType<typeof buildApp>;
  let token: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    store = createMemoryStore();
    app = buildApp({ repository: createRepository(testDb.db), store });
    const minted = await app.request("/tokens", { method: "POST" });
    token = ((await minted.json()) as { token: string }).token;
  });

  afterEach(async () => {
    await testDb.close();
  });

  const upload = (body: Uint8Array, contentType = "image/png", auth = token) =>
    app.request("/assets", {
      method: "POST",
      headers: {
        "content-type": contentType,
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body,
    });

  it("stores an upload and reports what it found in the bytes", async () => {
    const res = await upload(pngBytes(800, 600));
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      id: string; width: number; height: number; contentType: string; byteSize: number;
    };
    expect(body.width).toBe(800);
    expect(body.height).toBe(600);
    expect(body.contentType).toBe("image/png");
    expect(body.byteSize).toBe(24);
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("puts the bytes in the store under the recorded key", async () => {
    const res = await upload(pngBytes(4, 4));
    const { id } = (await res.json()) as { id: string };
    const row = await createRepository(testDb.db).findAsset(id);
    const stored = await store.get(row!.storageKey);
    expect(Array.from(stored!.bytes)).toEqual(Array.from(pngBytes(4, 4)));
  });

  // The client's header is a claim, not evidence. The stored type is whatever
  // the bytes actually are.
  it("ignores a lying content-type header", async () => {
    const res = await upload(jpegBytes(20, 10), "image/png");
    const body = (await res.json()) as { contentType: string };
    expect(body.contentType).toBe("image/jpeg");
  });

  it("rejects bytes that are not an image we accept", async () => {
    const res = await upload(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
    expect(res.status).toBe(415);
  });

  it("rejects an empty body", async () => {
    const res = await upload(new Uint8Array(0));
    expect(res.status).toBe(415);
  });

  it("rejects an upload past the size cap", async () => {
    const huge = new Uint8Array(10 * 1024 * 1024 + 1);
    huge.set(pngBytes(4, 4), 0);
    const res = await upload(huge);
    expect(res.status).toBe(413);
  });

  // The cap is a ceiling, not an exclusive bound: exactly 10MB is a legitimate
  // upload and must not be rejected by an off-by-one on the comparison.
  it("accepts an upload exactly at the size cap", async () => {
    const atCap = new Uint8Array(10 * 1024 * 1024);
    atCap.set(pngBytes(4, 4), 0);
    const res = await upload(atCap);
    expect(res.status).toBe(201);
  });

  it("rejects an unauthenticated upload", async () => {
    const res = await upload(pngBytes(4, 4), "image/png", "");
    expect(res.status).toBe(401);
  });

  it("returns the existing asset when the same owner re-uploads identical bytes", async () => {
    const first = (await (await upload(pngBytes(9, 9))).json()) as { id: string };
    const second = (await (await upload(pngBytes(9, 9))).json()) as { id: string };
    expect(second.id).toBe(first.id);
  });

  it("does not report 201 for a deduplicated upload", async () => {
    await upload(pngBytes(9, 9));
    expect((await upload(pngBytes(9, 9))).status).toBe(200);
  });

  /**
   * The route checks findAssetByChecksum before inserting, but that check and
   * the insert are not one atomic step: two concurrent uploads of the same
   * bytes by the same owner can both miss the check. The unique index then
   * refuses the second row, and the loser answers with the winner's asset,
   * exactly as a sequential duplicate does, and removes the bytes it stored.
   */
  it("answers the loser of a concurrent duplicate upload with the winner's asset", async () => {
    const puts: string[] = [];
    const deletes: string[] = [];
    const watched: ObjectStore = {
      put: async (key, bytes, type) => {
        puts.push(key);
        await store.put(key, bytes, type);
      },
      get: store.get,
      delete: async (key) => {
        deletes.push(key);
        await store.delete(key);
      },
    };
    const raced = buildApp({ repository: createRepository(testDb.db), store: watched });
    const send = () =>
      raced.request("/assets", {
        method: "POST",
        headers: { "content-type": "image/png", authorization: `Bearer ${token}` },
        body: pngBytes(40, 40),
      });

    const [a, b] = await Promise.all([send(), send()]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);

    const ids = [
      ((await a.json()) as { id: string }).id,
      ((await b.json()) as { id: string }).id,
    ];
    expect(ids[0]).toBe(ids[1]);

    const rows = await testDb.db.execute("select count(*)::int as count from assets");
    expect(rows.rows[0]).toMatchObject({ count: 1 });

    // Both requests stored bytes; the loser's object is gone, the winner's stays.
    const winnerKey = `assets/${ids[0]}`;
    expect(puts).toHaveLength(2);
    expect(deletes).toEqual(puts.filter((key) => key !== winnerKey));
    expect(await store.get(winnerKey)).not.toBeNull();
  });

  // Mutation-tested: swapping the order of store.put and createAsset (bytes
  // after the row instead of before) does not fail any other test in this
  // file, because none of them inject a store that can fail. This one does,
  // so the invariant has a test standing guard over it.
  it("does not leave an asset row behind when writing the bytes fails", async () => {
    const failingStore: ObjectStore = {
      async put() {
        throw new Error("simulated store failure");
      },
      get: store.get,
      delete: store.delete,
    };
    const failingApp = buildApp({ repository: createRepository(testDb.db), store: failingStore });

    const res = await failingApp.request("/assets", {
      method: "POST",
      headers: { "content-type": "image/png", authorization: `Bearer ${token}` },
      body: pngBytes(6, 6),
    });

    // However the failure surfaces, a torn write must not leave a row
    // pointing at bytes that were never stored — that row would render as a
    // permanently broken tile forever, since nothing ever retries a put.
    expect(res.status).toBe(500);
    const rows = await testDb.db.execute("select count(*)::int as count from assets");
    expect(rows.rows[0]).toMatchObject({ count: 0 });
  });

  it("serves the bytes back with the sniffed content type", async () => {
    const { id } = (await (await upload(jpegBytes(30, 20))).json()) as { id: string };
    const res = await app.request(`/assets/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual(
      Array.from(jpegBytes(30, 20)),
    );
  });

  // The Response constructor does not compute this on its own from a
  // Uint8Array body in this runtime — it must be set explicitly, or a client
  // reading the stream has no way to know when the image ends.
  it("sets content-length to the actual byte count", async () => {
    const { id } = (await (await upload(pngBytes(30, 20))).json()) as { id: string };
    const res = await app.request(`/assets/${id}`);
    expect(res.headers.get("content-length")).toBe("24");
  });

  // Sharing a list is the product, so its images cannot need the author's token.
  it("serves an asset without any token at all", async () => {
    const { id } = (await (await upload(pngBytes(5, 5))).json()) as { id: string };
    expect((await app.request(`/assets/${id}`)).status).toBe(200);
  });

  it("404s an unknown asset id", async () => {
    expect((await app.request("/assets/does-not-exist")).status).toBe(404);
  });

  // A NUL byte is not valid inside a Postgres text value: reaching the query
  // uncaught raises error 22021, which surfaces as a bare 500 — indistinguishable
  // from the database actually being broken. An id that cannot possibly exist
  // must 404 like any other unknown id, not fail differently from every other
  // impossible id.
  it("404s an id containing a NUL byte, rather than 500ing", async () => {
    const res = await app.request(`/assets/${encodeURIComponent("bad\0id")}`);
    expect(res.status).toBe(404);
  });

  it("404s an implausibly long id, rather than spending a query on it", async () => {
    const res = await app.request(`/assets/${"a".repeat(10000)}`);
    expect(res.status).toBe(404);
  });

  it("404s a traversal-shaped id", async () => {
    const res = await app.request(`/assets/${encodeURIComponent("../../etc/passwd")}`);
    expect(res.status).toBe(404);
  });

  // An id names one immutable byte string forever, so a cache never has to
  // revalidate. This is the whole reason storage keys are never reused.
  it("marks the response immutable", async () => {
    const { id } = (await (await upload(pngBytes(5, 5))).json()) as { id: string };
    const res = await app.request(`/assets/${id}`);
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("404s a row whose bytes are missing from the store", async () => {
    await createRepository(testDb.db).createAsset({
      id: "orphan",
      ownerId: "owner-1",
      storageKey: "assets/orphan",
      contentType: "image/png",
      byteSize: 10,
      width: 1,
      height: 1,
      checksum: "deadbeef",
      createdAt: NOW,
    });
    expect((await app.request("/assets/orphan")).status).toBe(404);
  });
});
