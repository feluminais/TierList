/** What a cache holds for one asset. */
export type StoreEntry<T> =
  | { status: "loading" }
  | { status: "ready"; image: T }
  | { status: "failed" };

export interface ImageStore<T> {
  /** Undefined means this asset is not held: nothing has asked for it, or it was evicted. */
  get: (assetId: string) => StoreEntry<T> | undefined;
  /**
   * Declares which assets are on the board right now. Starts a load for each
   * one not held, marks every one as recently used, and drops the least
   * recently used entries that are no longer wanted once the store is over
   * its cap. Wanted entries are never dropped.
   */
  want: (assetIds: readonly string[]) => void;
  /** Releases everything and cancels pending retries. Later results are released on arrival. */
  dispose: () => void;
}

export interface ImageStoreOptions<T> {
  /** Resolves the decoded image, or null when the bytes cannot be decoded. */
  load: (assetId: string) => Promise<T | null>;
  /** Frees what an image holds. */
  release: (image: T) => void;
  /** Called whenever an entry changes, so the owner can re-render. */
  onChange: () => void;
  schedule: (run: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  /** The most entries held before unwanted ones are dropped. */
  maxEntries?: number;
  /** Waits before each retry of a failed load; after the last, the entry stays failed. */
  retryDelaysMs?: readonly number[];
  /**
   * How long an evicted image is kept before it is released, so a frame already
   * recorded with it can finish drawing.
   */
  releaseDelayMs?: number;
}

export const DEFAULT_MAX_ENTRIES = 256;
export const DEFAULT_RETRY_DELAYS_MS = [2_000, 8_000, 30_000] as const;
export const DEFAULT_RELEASE_DELAY_MS = 1_000;

interface Record<T> {
  entry: StoreEntry<T>;
  wanted: boolean;
  /** Retries made so far; reset by a success. */
  attempts: number;
  retryTimer?: unknown;
  /** False once evicted or disposed, so a late result is released instead of stored. */
  live: boolean;
}

/**
 * The bookkeeping behind the board's image cache, with no Skia in it so it can
 * be tested on its own.
 *
 * A board holds one image per image tile, and the set changes as tiles come
 * and go, so a cache that only grows keeps every image the list ever showed.
 * This one holds what is wanted, keeps a bounded number of recently used
 * others so undoing a delete does not re-fetch, and releases the rest.
 *
 * A failed load is retried with backoff rather than remembered forever: the
 * usual cause is the network or a server restart, and a tile that stays blank
 * until the page is reloaded is the visible cost of treating that as final.
 */
export function createImageStore<T>(options: ImageStoreOptions<T>): ImageStore<T> {
  const {
    load,
    release,
    onChange,
    schedule,
    cancel,
    maxEntries = DEFAULT_MAX_ENTRIES,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    releaseDelayMs = DEFAULT_RELEASE_DELAY_MS,
  } = options;

  // Map iteration is insertion order; a record is re-inserted when used, so the
  // first unwanted record is always the least recently used.
  const records = new Map<string, Record<T>>();
  let disposed = false;

  function releaseLater(image: T): void {
    schedule(() => release(image), releaseDelayMs);
  }

  function evict(assetId: string, record: Record<T>): void {
    records.delete(assetId);
    record.live = false;
    if (record.retryTimer !== undefined) cancel(record.retryTimer);
    if (record.entry.status === "ready") releaseLater(record.entry.image);
  }

  function start(assetId: string, record: Record<T>): void {
    load(assetId).then(
      (image) => {
        if (!record.live) {
          // Evicted or disposed while loading. After disposal nothing will draw
          // again, so it goes at once; after eviction it gets the grace period.
          if (image) (disposed ? release(image) : releaseLater(image));
          return;
        }
        if (image) {
          record.attempts = 0;
          record.entry = { status: "ready", image };
          onChange();
        } else {
          failed(assetId, record);
        }
      },
      () => {
        if (record.live) failed(assetId, record);
      },
    );
  }

  function failed(assetId: string, record: Record<T>): void {
    record.entry = { status: "failed" };
    const delay = retryDelaysMs[record.attempts];
    if (delay !== undefined) {
      record.retryTimer = schedule(() => {
        record.retryTimer = undefined;
        if (!record.live || !record.wanted) return;
        record.attempts += 1;
        start(assetId, record);
      }, delay);
    }
    onChange();
  }

  return {
    get: (assetId) => records.get(assetId)?.entry,

    want(assetIds) {
      if (disposed) return;
      const wanted = new Set(assetIds);
      const wasWanted = new Set<string>();
      for (const [assetId, record] of records) {
        if (record.wanted) wasWanted.add(assetId);
        record.wanted = false;
      }

      for (const assetId of wanted) {
        const existing = records.get(assetId);
        if (existing) {
          existing.wanted = true;
          // A failure that was left behind (retries spent, or abandoned while
          // off the board) gets a fresh start when its tile comes back. One
          // that stayed on the board is not restarted by every later change.
          if (
            !wasWanted.has(assetId) &&
            existing.entry.status === "failed" &&
            existing.retryTimer === undefined
          ) {
            existing.attempts = 0;
            existing.entry = { status: "loading" };
            start(assetId, existing);
          }
          // Moved to the end: now the most recently used.
          records.delete(assetId);
          records.set(assetId, existing);
        } else {
          const record: Record<T> = { entry: { status: "loading" }, wanted: true, attempts: 0, live: true };
          records.set(assetId, record);
          start(assetId, record);
        }
      }

      for (const [assetId, record] of records) {
        if (records.size <= maxEntries) break;
        if (!record.wanted) evict(assetId, record);
      }
    },

    dispose() {
      disposed = true;
      for (const record of records.values()) {
        record.live = false;
        if (record.retryTimer !== undefined) cancel(record.retryTimer);
        // At once, not after a grace period: nothing is going to draw again.
        if (record.entry.status === "ready") release(record.entry.image);
      }
      records.clear();
    },
  };
}
