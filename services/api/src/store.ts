import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Where uploaded bytes live. Two adapters implement it — memory for tests, the
 * filesystem for a dev server — and routes are typed against this interface and
 * never against an adapter, so a difference between them shows up as a type
 * error rather than at runtime. An S3-compatible adapter is the same two
 * methods, and belongs with the deploy.
 */
export interface ObjectStore {
  put: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  get: (key: string) => Promise<StoredObject | null>;
  /** Removes a key. Removing one that is not there is done, not an error. */
  delete: (key: string) => Promise<void>;
}

/**
 * Keys are built by this service, never by a client — but the filesystem
 * adapter turns a key into a path, so a key that could contain `..` would be a
 * path traversal one refactor away from being reachable. Rejecting the shape
 * outright costs nothing and removes the whole class. Backslashes are refused
 * outright (never allowed inside a segment) because on Windows `path.join`
 * treats them as separators, which would let a key smuggle extra path
 * segments straight past this regex.
 *
 * Lowercase only, uppercase rejected outright. The adapters disagree on case
 * otherwise: a `Map` is case-sensitive and a filesystem may not be, so one key
 * written and a differently-cased key read resolves on one adapter and misses
 * on the other. Folding case inside each adapter would fix it twice,
 * separately, which stays in sync only by coincidence; rejecting uppercase at
 * the boundary means the two can only agree.
 *
 * It costs nothing: every key this service builds is `assets/${randomUUID()}`,
 * which is lowercase hex. A future key scheme wanting mixed case fails loudly
 * here rather than diverging between environments — read that as a prompt to
 * reconsider the scheme, not a bug to route around.
 */
const SAFE_KEY = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key)) throw new Error(`unsafe object key: ${key}`);
}

export function createMemoryStore(): ObjectStore {
  const objects = new Map<string, StoredObject>();

  return {
    async put(key, bytes, contentType) {
      assertSafeKey(key);
      // Copied on the way in and on the way out. A Map holding a caller's array
      // would let a later mutation of that array rewrite stored content, which
      // the filesystem adapter cannot do — and the two must not differ.
      objects.set(key, { bytes: new Uint8Array(bytes), contentType });
    },

    async get(key) {
      assertSafeKey(key);
      const found = objects.get(key);
      if (!found) return null;
      return { bytes: new Uint8Array(found.bytes), contentType: found.contentType };
    },

    async delete(key) {
      assertSafeKey(key);
      objects.delete(key);
    },
  };
}

/**
 * The content type is stored beside the bytes rather than inferred from an
 * extension, so the store never re-derives a fact the upload boundary already
 * established.
 */
export function createFileStore(root: string): ObjectStore {
  const resolve = (key: string, suffix: string) => path.join(root, `${key}${suffix}`);

  return {
    async put(key, bytes, contentType) {
      assertSafeKey(key);
      const target = resolve(key, ".bin");
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      // Two separate writes, not one atomic operation: a process death between
      // them leaves `.bin` on disk with no matching `.type`. `get` then hits
      // ENOENT reading the sidecar and reports a miss — bytes exist but read
      // back as "never written". Acceptable: the contract only promises
      // behaviour for a *completed* put, and this window is never observable
      // from a caller that awaits put() before ever calling get().
      await writeFile(resolve(key, ".type"), contentType, "utf8");
    },

    async get(key) {
      assertSafeKey(key);
      try {
        const bytes = await readFile(resolve(key, ".bin"));
        const contentType = await readFile(resolve(key, ".type"), "utf8");
        return { bytes: new Uint8Array(bytes), contentType };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw e;
      }
    },

    async delete(key) {
      assertSafeKey(key);
      // The sidecar goes first: a `.bin` with no `.type` reads as a miss, so a
      // delete interrupted between the two leaves nothing a reader can fetch.
      for (const suffix of [".type", ".bin"]) {
        try {
          await unlink(resolve(key, suffix));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
      }
    },
  };
}
