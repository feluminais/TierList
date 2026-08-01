import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredObject {
  bytes: Uint8Array;
  contentType: string;
}

/**
 * Where uploaded bytes live. Two adapters implement it — memory for tests, the
 * filesystem for a dev server — and routes are typed against this interface and
 * never against an adapter, so a difference between them shows up as a type
 * error rather than at runtime. An S3/R2 adapter is the same methods and
 * belongs with 1E, when there is somewhere to deploy it to.
 */
export interface ObjectStore {
  put: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>;
  get: (key: string) => Promise<StoredObject | null>;
}

/**
 * Keys are built by this service, never by a client — but the filesystem
 * adapter turns a key into a path, so a key that could contain `..` would be a
 * path traversal one refactor away from being reachable. Rejecting the shape
 * outright costs nothing and removes the whole class. Backslashes are refused
 * outright (never allowed inside a segment) because on Windows `path.join`
 * treats them as separators, which would let a key smuggle extra path
 * segments straight past this regex.
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

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
  };
}
