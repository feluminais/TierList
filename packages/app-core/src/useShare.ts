"use client";

import type { Client } from "@tl/api-client";
import { toTemplate, type TierList } from "@tl/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { newListId } from "./ids";

export interface ShareState {
  /** Creates (or re-fetches) the read-only link to this list. */
  share: () => Promise<void>;
  /**
   * Publishes a snapshot of this list as a template others can fill.
   *
   * `listed` opts the template into browse pages. Listing is a separate
   * decision from sharing — an author who sends a link to two friends has not
   * asked to be indexed — so it is passed rather than assumed.
   */
  shareTemplate: (listed: boolean) => Promise<void>;
  /**
   * Withdraws the read-only link, which stops working for everyone who has it.
   * The list is untouched; sharing it again gives a new code.
   */
  unshare: () => Promise<void>;
  /** Withdraws the template link the same way. The published template stays. */
  unshareTemplate: () => Promise<void>;
  sharing: boolean;
  /** The read-only link, once one exists. */
  url: string | null;
  /** The template link, once one has been published. */
  templateUrl: string | null;
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
  doc: TierList,
  ogImage: OgImageSource,
  shareUrlFor: (code: string) => string,
): ShareState {
  const [sharing, setSharing] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [templateUrl, setTemplateUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read through a ref so publishing a template does not have to re-key on
  // every edit: the callback wants whatever the document is *when it runs*,
  // and a dependency on `doc` would rebuild it on every keystroke.
  const docRef = useRef(doc);
  docRef.current = doc;

  // A mount flag owned by its own empty-dependency effect, exactly as
  // `useAutosave` and `useAssetUpload` use one, and for the same reason: this
  // resolves after two network round trips and must not call into a dead tree.
  // The template this session published, so a second press re-shares it rather
  // than creating a second one.
  const templateIdRef = useRef<string | null>(null);

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

      const result = await client.shareList(listId, { ogAssetId });
      if (mounted.current) setUrl(shareUrlFor(result.code));
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setSharing(false);
    }
  }, [client, listId, ogImage, shareUrlFor]);

  /**
   * Publish the list as a template and share *that*.
   *
   * A separate document, not a flag on this one. `toTemplate` snapshots the
   * rows and items as they stand and puts every item in the tray, so a fill
   * started from it is stable: editing this list afterwards cannot make items
   * appear or vanish under someone who is halfway through ranking them. It
   * also means the author keeps their own arrangement — publishing does not
   * empty the board they were looking at.
   *
   * Idempotent in the way that matters: a second press re-shares the template
   * already created rather than publishing another, because the id is minted
   * once and kept.
   */
  const shareTemplate = useCallback(async (listed: boolean) => {
    if (!client) {
      setError("not connected to an API");
      return;
    }

    setError(null);
    setSharing(true);
    try {
      let id = templateIdRef.current;
      if (!id) {
        id = newListId();
        await client.createList(
          toTemplate(docRef.current, { id, now: new Date().toISOString() }),
        );
        templateIdRef.current = id;
      }
      const result = await client.shareList(id, { listed });
      if (mounted.current) setTemplateUrl(shareUrlFor(result.code));
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (mounted.current) setSharing(false);
    }
  }, [client, shareUrlFor]);

  /**
   * Runs a withdrawal and, only when the server confirms it, forgets the link:
   * a link still on screen after a failed withdrawal would say it was gone
   * when it was not.
   */
  const withdraw = useCallback(
    async (idOf: () => string | null, forget: () => void) => {
      const id = idOf();
      if (!client || !id) {
        setError("not connected to an API");
        return;
      }
      setError(null);
      setSharing(true);
      try {
        await client.unshareList(id);
        if (mounted.current) forget();
      } catch (e) {
        if (mounted.current) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted.current) setSharing(false);
      }
    },
    [client],
  );

  const unshare = useCallback(
    () => withdraw(() => listId, () => setUrl(null)),
    [withdraw, listId],
  );
  const unshareTemplate = useCallback(
    () => withdraw(() => templateIdRef.current, () => setTemplateUrl(null)),
    [withdraw],
  );

  return { share, shareTemplate, unshare, unshareTemplate, sharing, url, templateUrl, error };
}
