import EditorClient from "../EditorClient";

interface PageProps {
  // Next hands route params as a promise.
  params: Promise<{ listId: string }>;
}

/**
 * The editor, on one named list.
 *
 * The id lives in the route rather than in storage, which is what lets a
 * browser hold more than one list at a time — a list of your own, a template
 * you published, and a fill you started from someone else's link are three
 * documents, and before this they would all have written to the same id.
 */
export default async function EditorPage({ params }: PageProps) {
  const { listId } = await params;
  return (
    <main style={{ padding: 24, background: "#0b0d10", minHeight: "100vh" }}>
      <EditorClient listId={decodeURIComponent(listId)} />
    </main>
  );
}
