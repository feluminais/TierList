"use client";

import dynamic from "next/dynamic";

// `"use client"` alone does not prevent server rendering - client components
// are still rendered on the server for the initial HTML, which was causing
// CanvasKit to initialise there and abort. `ssr: false` is illegal inside a
// Server Component but legal here, and keeps CanvasKit out of the server
// bundle entirely.
const SkiaHost = dynamic(() => import("./SkiaHost"), {
  ssr: false,
  loading: () => <p style={{ color: "#888" }}>Loading canvas…</p>,
});

export default function SpikeClient() {
  return <SkiaHost />;
}
