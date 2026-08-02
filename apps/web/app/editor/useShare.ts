"use client";

import type { Client } from "@tl/api-client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface ShareState {
  share: () => Promise<void>;
  sharing: boolean;
  /** The public link, once one exists. */
  url: string | null;
  error: string | null;
}

/** Bytes of the link-preview image, or null when the canvas cannot produce any. */
export type OgImageSource = () => { bytes: Uint8Array; contentType: string } | null;

/**
 * Creates the list's public link and gives it a picture.
 *
 * Three steps, in this order, and the order is the point:
 *
 * 1. Snapshot the board through the editor's own Skia canvas.
 * 2. Upload it as an ordinary asset — the same owned `POST /assets` a tile
 *    image goes through, so it inherits per-owner dedupe and the public,
 *    immutable read path a reader will fetch it from.
 * 3. Create (or re-fetch) the share code, pointing it at that asset.
 *
 * Step 3 must not be gated on 1 or 2. A link with a title and no preview
 * picture is a working link; no link at all is not. So a snapshot that comes
 * back null — an unmounted canvas, a lost WebGL context — or an upload that
 * fails is swallowed and the share is created anyway. The failure a user
 * actually needs to hear about is the one from step 3.
 */
export function useShare(
  client: Client | null,
  listId: string | null,
  ogImage: OgImageSource,
  shareUrlFor: (code: string) => string,
): ShareState {
  const [sharing, setSharing] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A mount flag owned by its own empty-dependency effect, exactly as
  // `useAutosave` and `useAssetUpload` use one, and for the same reason: this
  // resolves after two network round trips and must not call into a dead tree.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const share = useCallback(async () => {
    if (!client || !listId) {
      setError("not connected to an API");
      return;
    }

    setError(null);
    setSharing(true);
    try {
      let ogAssetId: string | undefined;
      try {
        const snapshot = ogImage();
        if (snapshot) {
          const asset = await client.uploadAsset(snapshot.bytes, snapshot.contentType);
          ogAssetId = asset.id;
        }
      } catch {
        // Deliberately swallowed — see the docblock. A preview image is a
        // nicety; the link is the deliverable.
      }

      const result = await client.shareList(listId, ogAssetId);
      if (mounted.current) setUrl(shareUrlFor(result.code));
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setSharing(false);
    }
  }, [client, listId, ogImage, shareUrlFor]);

  return { share, sharing, url, error };
}
