import { Skia, type SkImage } from "@shopify/react-native-skia";
import { useEffect, useReducer, useRef, useState } from "react";
import { createImageStore, type ImageStore, type StoreEntry } from "./imageStore";

export type ImageEntry = StoreEntry<SkImage>;

export interface ImageCache {
  /** Undefined means nothing has asked for this asset yet, or it was evicted. */
  get: (assetId: string) => ImageEntry | undefined;
}

/**
 * Loads an image per `assetId` and re-renders when one arrives.
 *
 * `useImage` cannot do this job: it is a hook, and a board has N image tiles
 * with N varying per render, so it cannot be called per tile. `TierBoard` hit
 * the identical wall with fonts. So the cache is imperative — an
 * `ImageStore` held in state — and a counter forces the re-render that a
 * mutation cannot.
 *
 * The store bounds what is held, releases the images it drops and retries a
 * failed load; see `imageStore.ts`. This hook only supplies Skia's loading and
 * releasing and ties the store's life to the component's.
 */
export function useImageCache(
  assetIds: readonly string[],
  assetUrl: (assetId: string) => string,
): ImageCache {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  // Read at load time through a ref, so a new `assetUrl` closure neither
  // recreates the store nor restarts a load.
  const urlRef = useRef(assetUrl);
  useEffect(() => {
    urlRef.current = assetUrl;
  });

  /**
   * Created in an effect and disposed in its cleanup, so a mount that React
   * tears down and repeats (strict mode, a Fast Refresh) gets a fresh store
   * rather than one that has already released everything.
   *
   * The store only calls `onChange` for entries it still holds, so nothing
   * reaches `bump` after the cleanup has run: a dependency change may cancel
   * scheduling, but a result for a live entry is always delivered.
   */
  const [store, setStore] = useState<ImageStore<SkImage> | null>(null);
  useEffect(() => {
    const created = createImageStore<SkImage>({
      load: async (assetId) => {
        const data = await Skia.Data.fromURI(urlRef.current(assetId));
        // A null image is a decode failure, not an exception — CanvasKit
        // returns null for bytes it does not recognise rather than throwing.
        return Skia.Image.MakeImageFromEncoded(data);
      },
      release: (image) => image.dispose(),
      onChange: bump,
      schedule: (run, ms) => setTimeout(run, ms),
      cancel: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    setStore(created);
    return () => created.dispose();
  }, []);

  /**
   * A stable string, not the array.
   *
   * `assetIds` is derived from the document, so it is a new array on every
   * render; keying the effect on it restarts every load on every unrelated
   * re-render. This is the same trap as keying an effect on the object
   * `pendingWrite` returns.
   */
  const key = assetIds.join(" ");
  useEffect(() => {
    store?.want(assetIds);
    // `assetIds` is intentionally absent: `key` is its stable projection, and
    // depending on the array itself is the bug this exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, key]);

  return { get: (assetId) => store?.get(assetId) };
}
