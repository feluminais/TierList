"use client";

import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

/**
 * Isolated so that `SpikeClient` can pull it in via `next/dynamic` with
 * `ssr: false`. CanvasKit must never be instantiated during SSR: there is no
 * HTTP origin on the server, so `locateFile` below would be resolved as a
 * filesystem path (`/canvaskit.wasm` -> `M:\canvaskit.wasm`) and abort.
 */
export default function SkiaHost() {
  return (
    <WithSkiaWeb
      // Browser-side: resolve the wasm against the site root, where
      // `setup-skia-web` placed it (apps/web/public/canvaskit.wasm). Without
      // this, CanvasKit derives the URL from its own module path, which
      // Turbopack rewrites to a non-existent `/ROOT/node_modules/...` path.
      opts={{ locateFile: (file: string) => `/${file}` }}
      getComponent={async () => ({
        default: (await import("@tl/editor-spike")).SpikeCanvas,
      })}
      componentProps={{ width: 640, height: 480 }}
      fallback={<p style={{ color: "#888" }}>Loading canvas…</p>}
    />
  );
}
