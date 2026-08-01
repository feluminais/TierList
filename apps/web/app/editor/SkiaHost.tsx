"use client";

import { createTierList, reduce, type TierList } from "@tl/core";
import { useEffect, useMemo, useState, type ComponentType } from "react";

type BoardProps = { doc: TierList; width: number };

/**
 * Nothing Skia-related may be imported at module scope in this file.
 *
 * `@shopify/react-native-skia/lib/module/skia/Skia.web.js` builds its API
 * object at module scope:
 *
 *     export const Skia = JsiSkApi(global.CanvasKit);
 *
 * so that module must not be evaluated until after CanvasKit is on the global.
 * Doing both imports dynamically, in order, inside the effect makes that
 * ordering explicit instead of relying on bundler chunking — which the spike
 * proved differs between dev and production, and not in the direction anyone
 * assumed.
 */
export default function SkiaHost() {
  const [Board, setBoard] = useState<ComponentType<BoardProps> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { LoadSkiaWeb } = await import(
          "@shopify/react-native-skia/lib/module/web/LoadSkiaWeb"
        );
        // CanvasKit derives its own WASM URL from a module URL that Turbopack
        // rewrites with a ROOT/ prefix, producing a 404. Naming the path
        // explicitly is the fix.
        await LoadSkiaWeb({ locateFile: (file: string) => `/${file}` });

        const mod = await import("@tl/editor");
        if (!alive) return;
        setBoard(() => mod.TierBoard);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const doc = useMemo(() => sampleDoc(), []);

  if (error) {
    return <pre style={{ color: "#f88", padding: 16 }}>{error}</pre>;
  }
  if (!Board) {
    return <p style={{ color: "#888", padding: 16 }}>Loading canvas…</p>;
  }
  return <Board doc={doc} width={800} />;
}

/** A throwaway document so there is something to look at. Milestone 2D loads a real one. */
function sampleDoc(): TierList {
  const now = "2026-08-01T12:00:00.000Z";
  let doc = createTierList({ id: "preview", now });
  const labels = ["Ramen", "Udon", "Soba", "Pho", "Laksa", "Bun bo Hue"];
  labels.forEach((label, i) => {
    doc = reduce(doc, { type: "item/addText", id: `i${i}`, label }, now);
  });
  doc = reduce(doc, { type: "placement/place", itemId: "i0", rowId: "preview-row-0", index: 0 }, now);
  doc = reduce(doc, { type: "placement/place", itemId: "i1", rowId: "preview-row-0", index: 1 }, now);
  doc = reduce(doc, { type: "placement/place", itemId: "i2", rowId: "preview-row-1", index: 0 }, now);
  return doc;
}
