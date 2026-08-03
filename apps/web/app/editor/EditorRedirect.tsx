"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { LIST_ID_KEY } from "./SkiaHost";
import { newListId } from "@tl/app-core";

/**
 * Sends `/editor` on to `/editor/<id>`.
 *
 * `replace` rather than `push`: this route is a signpost, and leaving it in the
 * history would make Back from the editor land here and bounce straight
 * forward again.
 */
export default function EditorRedirect() {
  const router = useRouter();

  useEffect(() => {
    let id: string | null = null;
    try {
      id = window.localStorage.getItem(LIST_ID_KEY);
    } catch {
      // Storage can throw under some privacy settings. A new list is a fine
      // answer — better than refusing to open the editor at all.
    }
    router.replace(`/editor/${encodeURIComponent(id ?? newListId())}`);
  }, [router]);

  return <p style={{ color: "#888", padding: 16 }}>Opening your list…</p>;
}
