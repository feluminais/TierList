"use client";

import {
  createTierList,
  reduce,
  type TierList,
  type TierListAction,
} from "@tl/core";
import { useCallback, useEffect, useState, type ComponentType } from "react";

type BoardProps = {
  doc: TierList;
  width: number;
  onAction: (action: TierListAction) => void;
};

/** Width the board is laid out against. Also the width of the surface below
 *  that claims touch input, so the two cannot drift apart. */
const BOARD_WIDTH = 800;

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
        setBoard(() => mod.InteractiveBoard);
      } catch (e) {
        if (alive) setError(String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const [doc, setDoc] = useState<TierList>(sampleDoc);

  // The clock lives here, at the boundary, exactly as it does in the gesture
  // hook. A drag emits at most one action, so this runs once per completed
  // drag and not once per frame.
  const onAction = useCallback((action: TierListAction) => {
    setDoc((current) => reduce(current, action, new Date().toISOString()));
  }, []);

  if (error) {
    return <pre style={{ color: "#f88", padding: 16 }}>{error}</pre>;
  }
  if (!Board) {
    return <p style={{ color: "#888", padding: 16 }}>Loading canvas…</p>;
  }
  return (
    // `touch-action: none` is the only thing that stops a mobile browser
    // stealing a drag. Once Chrome decides a touch belongs to a scroll it fires
    // `touchcancel`, and react-native-web's responder system terminates on that
    // path unconditionally — it consults `onResponderTerminationRequest` only
    // for `contextmenu`, `scroll` and `selectionchange`
    // (ResponderSystem.js, `isTerminateEvent`). Returning `false` cannot save
    // the gesture, so the browser has to be stopped from claiming it at all.
    // react-native-web reaches for the same lever for the same reason, and says
    // so: see the comment above `scrollDisabled` in ScrollViewBase.
    //
    // The cost is that this surface no longer pans the page on a touch screen.
    // Sized to the board rather than the block default so it costs exactly the
    // board and not the empty column beside it.
    //
    // Autoscroll is deliberately not wired here. This route has no scroll
    // container of its own — the page scrolls — so there is no viewport to
    // measure a pointer against and no scroller to drive. It is exercised on
    // mobile, where the board sits inside a ScrollView. When 2D gives this
    // route real chrome, the board should get its own scroll container and the
    // two can be wired together, which also gives the panning back.
    <div style={{ touchAction: "none", width: BOARD_WIDTH }}>
      <Board doc={doc} width={BOARD_WIDTH} onAction={onAction} />
    </div>
  );
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
