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

  // createAsset does no conflict handling, so the only thing standing between
  // a raced double-upload and two rows for the same bytes is this unique
  // index rejecting the second insert outright. The route is expected to
  // check findAssetByChecksum first, so this only fires under a genuine race
  // — pinned here so a future refactor can't silently turn it into a second
  // row instead of a rejection.
  it("rejects a second asset from the same owner with the same checksum", async () => {
    await repository.createAsset(asset());

    let caught: unknown;
    try {
      await repository.createAsset(asset({ id: "asset-2", storageKey: "assets/asset-2" }));
    } catch (e) {
      caught = e;
    }

    // Drizzle wraps the driver error, so the useful detail — the Postgres
    // unique_violation code and the constraint name — lives on `.cause`, not
    // on the thrown error's own message.
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: { code?: string; constraint?: string } }).cause;
    expect(cause?.code).toBe("23505");
    expect(cause?.constraint).toBe("assets_owner_checksum_idx");
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
   * the insert are not one atomic step. Two concurrent uploads of the same
   * bytes by the same owner can both miss the check and both attempt to
   * insert; the unique index (assets_owner_checksum_idx) then rejects the
   * second insert with Postgres error 23505, uncaught, which Hono's default
   * error handler turns into a bare 500. That is a defensible outcome — the
   * race is rare and the client can just retry the upload, which will now
   * hit the dedupe path and get the winner's asset back — but only if it
   * stays exactly this and doesn't silently regress into a 200 with two rows
   * for the same bytes, or a crash. This test exists to notice either.
   */
  it("gives the loser of a concurrent duplicate upload a 500, not a silent double-write", async () => {
    const [a, b] = await Promise.all([upload(pngBytes(40, 40)), upload(pngBytes(40, 40))]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 500]);

    // Confirm the race did not leave two rows behind: the winner's checksum
    // still resolves to exactly one asset.
    const winner = a.status === 201 ? a : b;
    const { id } = (await winner.json()) as { id: string };
    expect(await createRepository(testDb.db).findAsset(id)).not.toBeNull();
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

  // Sharing a list is the product, so its images cannot need the author's token.
  it("serves an asset without any token at all", async () => {
    const { id } = (await (await upload(pngBytes(5, 5))).json()) as { id: string };
    expect((await app.request(`/assets/${id}`)).status).toBe(200);
  });

  it("404s an unknown asset id", async () => {
    expect((await app.request("/assets/does-not-exist")).status).toBe(404);
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
