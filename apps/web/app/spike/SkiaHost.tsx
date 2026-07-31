"use client";

import { useEffect, useState, type ComponentType } from "react";

type Props = { width: number; height: number };

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
 * ordering explicit instead of relying on bundler chunking.
 */
export default function SkiaHost() {
  const [Comp, setComp] = useState<ComponentType<Props> | null>(null);
  const [diag, setDiag] = useState<string>("starting");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setDiag("importing loader");
        const { LoadSkiaWeb } = await import(
          "@shopify/react-native-skia/lib/module/web/LoadSkiaWeb"
        );

        setDiag("loading canvaskit");
        await LoadSkiaWeb({ locateFile: (file: string) => `/${file}` });

        const g = globalThis as Record<string, unknown>;
        const hasCK =
          typeof g.CanvasKit !== "undefined" ||
          (typeof g.global === "object" &&
            g.global !== null &&
            typeof (g.global as Record<string, unknown>).CanvasKit !==
              "undefined");

        setDiag(
          `canvaskit loaded: ${hasCK} | typeof global: ${typeof g.global} | importing component`,
        );

        const mod = await import("@tl/editor-spike");
        if (!alive) return;
        setComp(() => mod.SpikeCanvas);
        setDiag(`ready | canvaskit: ${hasCK}`);
      } catch (e) {
        if (alive) setDiag(`FAILED: ${String(e)}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div>
      <pre
        style={{
          background: "#111",
          color: "#8f8",
          padding: 8,
          fontSize: 12,
          whiteSpace: "pre-wrap",
        }}
      >
        {diag}
      </pre>
      {Comp ? (
        <Comp width={640} height={480} />
      ) : (
        <p style={{ color: "#888" }}>Loading canvas…</p>
      )}
    </div>
  );
}
