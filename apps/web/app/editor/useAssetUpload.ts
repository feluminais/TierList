"use client";

import type { AssetResponse, Client } from "@tl/api-client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface AssetUpload {
  upload: (file: File) => Promise<void>;
  uploading: boolean;
  error: string | null;
}

/**
 * Turns a picked file into an uploaded asset.
 *
 * The whole `AssetResponse` is reported through a callback rather than
 * returned, because the caller has to mint the *item* id too and dispatch a
 * single `item/addImage` carrying both — one action, one undo step, one
 * revision. The full response (not just the id) matters: it carries the
 * `width`/`height` the server measured, which the caller needs to compute an
 * aspect-locked crop before that single dispatch.
 */
export function useAssetUpload(
  client: Client | null,
  onUploaded: (asset: AssetResponse) => void,
): AssetUpload {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * A mount flag owned by its own empty-dependency effect, exactly as
   * `useAutosave` uses one and for the same reason: an upload that resolves
   * after the component has gone must not call back into a dead tree, and a
   * per-call `cancelled` flag would not survive the re-render that starting
   * the upload itself causes.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const upload = useCallback(
    async (file: File) => {
      if (!client) {
        // Not a silent no-op: with no API configured this is the normal state
        // of this route, and a button that appears to do nothing is worse than
        // one that says why.
        setError("not connected to an API");
        return;
      }

      setError(null);
      setUploading(true);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        // The declared type is a hint only — the server decides what the image
        // really is by reading the bytes, and may correct it.
        const asset = await client.uploadAsset(bytes, file.type || "application/octet-stream");
        if (mounted.current) onUploaded(asset);
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted.current) setUploading(false);
      }
    },
    [client, onUploaded],
  );

  return { upload, uploading, error };
}
