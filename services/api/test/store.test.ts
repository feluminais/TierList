import { mkdir, mkdtemp, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createFileStore, createMemoryStore, type ObjectStore } from "../src/store";

const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryRoots.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function fileStore(): Promise<ObjectStore> {
  const root = await mkdtemp(path.join(tmpdir(), "tl-store-"));
  temporaryRoots.push(root);
  return createFileStore(root);
}

/**
 * One contract, both adapters. The in-memory store is what tests run against
 * and the filesystem store is what a dev server uses, so any behaviour that
 * differs between them is a bug that would only ever appear outside the tests.
 */
describe.each([
  ["memory", async () => createMemoryStore()],
  ["file", fileStore],
])("ObjectStore — %s", (_name, make) => {
  it("returns what was written", async () => {
    const store = await make();
    await store.put("a/b", new Uint8Array([1, 2, 3]), "image/png");
    const got = await store.get("a/b");
    expect(got?.contentType).toBe("image/png");
    expect(Array.from(got?.bytes ?? [])).toEqual([1, 2, 3]);
  });

  it("returns null for a key that was never written", async () => {
    const store = await make();
    expect(await store.get("missing")).toBeNull();
  });

  it("keeps distinct keys apart", async () => {
    const store = await make();
    await store.put("one", new Uint8Array([1]), "image/png");
    await store.put("two", new Uint8Array([2]), "image/jpeg");
    expect(Array.from((await store.get("one"))!.bytes)).toEqual([1]);
    expect((await store.get("two"))!.contentType).toBe("image/jpeg");
  });

  it("stores an empty payload as an empty payload, not as absent", async () => {
    const store = await make();
    await store.put("empty", new Uint8Array(0), "image/png");
    const got = await store.get("empty");
    expect(got).not.toBeNull();
    expect(got!.bytes.length).toBe(0);
  });

  it("overwrites a key that already exists", async () => {
    const store = await make();
    await store.put("k", new Uint8Array([1]), "image/png");
    await store.put("k", new Uint8Array([9, 9]), "image/webp");
    const got = await store.get("k");
    expect(Array.from(got!.bytes)).toEqual([9, 9]);
    expect(got!.contentType).toBe("image/webp");
  });

  it("does not hand back a view a caller can mutate into the store", async () => {
    const store = await make();
    const source = new Uint8Array([1, 2, 3]);
    await store.put("k", source, "image/png");
    source[0] = 99;
    const got = await store.get("k");
    got!.bytes[1] = 88;
    expect(Array.from((await store.get("k"))!.bytes)).toEqual([1, 2, 3]);
  });

  it("refuses a key that would escape the store", async () => {
    const store = await make();
    await expect(
      store.put("../escape", new Uint8Array([1]), "image/png"),
    ).rejects.toThrow(/key/i);
    await expect(store.get("../escape")).rejects.toThrow(/key/i);
  });
});

/**
 * A miss must mean "nothing was ever written here" — a null. Any other
 * failure reading the backing storage (permissions, a corrupted sidecar
 * file, disk error) is a different situation and must not be silently
 * reported as a miss. Only reproducible on the filesystem adapter: the
 * memory adapter has no failure mode besides a genuine miss.
 */
it("ObjectStore — file: does not turn a non-missing-key error into a null", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "tl-store-"));
  const store = createFileStore(root);
  await store.put("k", new Uint8Array([1]), "image/png");
  // Corrupt the sidecar file into a directory so reading it throws something
  // other than ENOENT (EISDIR here), without relying on OS permission errors.
  await unlink(path.join(root, "k.type"));
  await mkdir(path.join(root, "k.type"));
  await expect(store.get("k")).rejects.toThrow();
  await rm(root, { recursive: true, force: true });
});
