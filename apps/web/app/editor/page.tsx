import EditorRedirect from "./EditorRedirect";

/**
 * `/editor` with no id: go to the list this browser was last editing, or to a
 * brand new one.
 *
 * A redirect rather than an editor of its own, so there is exactly one route
 * that edits a list and exactly one place that decides which. Resolved on the
 * client because the answer is in `localStorage`, which the server cannot see —
 * rendering an editor here and *then* discovering the id would mount the canvas
 * against the wrong document first.
 */
export default function EditorIndexPage() {
  return (
    <main style={{ padding: 24, background: "#0b0d10", minHeight: "100vh" }}>
      <EditorRedirect />
    </main>
  );
}
