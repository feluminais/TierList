"use client";

import dynamic from "next/dynamic";

// `"use client"` alone does not prevent server rendering — client components
// are still rendered on the server for the initial HTML, which made CanvasKit
// initialise there and read /canvaskit.wasm as a filesystem path. That
// surfaced as an unhandled rejection while the page still returned HTTP 200,
// so the build went green with the page broken.
//
// `ssr: false` is a build error inside a Server Component on Next 15+, but
// legal here. That is the only reason this file exists separately from
// page.tsx.
const SkiaHost = dynamic(() => import("./SkiaHost"), {
  ssr: false,
  loading: () => <p style={{ color: "#888", padding: 16 }}>Loading canvas…</p>,
});

export default function EditorClient({ listId }: { listId: string }) {
  // Keyed on the list so switching to another one remounts rather than reusing
  // the editor's state. The session, its history and its save status all belong
  // to one document; carrying them across would offer an undo that restores a
  // different list's content.
  return <SkiaHost key={listId} listId={listId} />;
}
