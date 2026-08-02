import ListsClient from "./ListsClient";

/**
 * Every list this browser owns.
 *
 * Client-rendered because ownership is a device token in `localStorage`, which
 * the server cannot see — there is no session, so there is no server-side
 * answer to "whose lists are these".
 */
export default function ListsPage() {
  return (
    <main style={{ padding: 24, background: "#0b0d10", minHeight: "100vh" }}>
      <ListsClient />
    </main>
  );
}
