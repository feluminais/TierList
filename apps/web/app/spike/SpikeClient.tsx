"use client";

import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

export default function SpikeClient() {
  return (
    <WithSkiaWeb
      getComponent={async () => ({
        default: (await import("@tl/editor-spike")).SpikeCanvas,
      })}
      componentProps={{ width: 640, height: 480 }}
      fallback={<p style={{ color: "#888" }}>Loading canvas…</p>}
    />
  );
}
