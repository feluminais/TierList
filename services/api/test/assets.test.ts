import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepository, type Repository } from "../src/repository";
import { createTestDb, type TestDb } from "./helpers/pglite";

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
