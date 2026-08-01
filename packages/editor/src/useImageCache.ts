import { Skia, type SkImage } from "@shopify/react-native-skia";
import { useEffect, useReducer, useRef } from "react";

export type ImageEntry =
  | { status: "loading" }
  | { status: "ready"; image: SkImage }
  | { status: "failed" };

export interface ImageCache {
  /** Undefined means nothing has asked for this asset yet. */
  get: (assetId: string) => ImageEntry | undefined;
}

/**
 * Loads an image per `assetId` and re-renders when one arrives.
 *
 * `useImage` cannot do this job: it is a hook, and a board has N image tiles
 * with N varying per render, so it cannot be called per tile. `TierBoard` hit
 * the identical wall with fonts. So the cache is imperative — a Map in a ref —
 * and a counter forces the re-render that a Map mutation cannot.
 */
export function useImageCache(
  assetIds: readonly string[],
  assetUrl: (assetId: string) => string,
): ImageCache {
  const cache = useRef(new Map<string, ImageEntry>());
  const [, bump] = useReducer((n: number) => n + 1, 0);

  /**
   * Owned by its own empty-dependency effect, so it tracks the component's
   * lifetime and not the load effect's.
   *
   * A per-run `let cancelled` set in the load effect's cleanup would be wrong
   * here in the same way it is wrong in `useAutosave`: adding one tile changes
   * `key` below, React tears the previous run down, and every load still in
   * flight would be silenced — leaving those entries stuck at `loading`
   * forever, with the tiles blank and nothing reporting an error. A dependency
   * change may cancel *scheduling*; it may never cancel an *outcome*.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
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
    for (const assetId of assetIds) {
      if (cache.current.has(assetId)) continue;
      cache.current.set(assetId, { status: "loading" });

      Skia.Data.fromURI(assetUrl(assetId))
        .then((data) => {
          const image = Skia.Image.MakeImageFromEncoded(data);
          // A null image is a decode failure, not an exception — CanvasKit
          // returns null for bytes it does not recognise rather than throwing.
          cache.current.set(
            assetId,
            image ? { status: "ready", image } : { status: "failed" },
          );
        })
        .catch(() => {
          cache.current.set(assetId, { status: "failed" });
        })
        .finally(() => {
          // Guarded by the mount flag, never by a per-run cancelled flag.
          if (mounted.current) bump();
        });
    }
    // `assetIds` is intentionally absent: `key` is its stable projection, and
    // depending on the array itself is the bug this exists to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, assetUrl]);

  return { get: (assetId) => cache.current.get(assetId) };
}
