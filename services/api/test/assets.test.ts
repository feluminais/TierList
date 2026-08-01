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

  it("lets two owners hold identical bytes as separate assets", async () => {
    await repository.createAsset(asset());
    await repository.createAsset(
      asset({ id: "asset-2", ownerId: "owner-2", storageKey: "assets/asset-2" }),
    );
    expect((await repository.findAssetByChecksum("owner-1", "abc123"))?.id).toBe("asset-1");
    expect((await repository.findAssetByChecksum("owner-2", "abc123"))?.id).toBe("asset-2");
  });
});
