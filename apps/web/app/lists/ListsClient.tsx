"use client";

import type { ListSummary } from "@tl/api-client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { newListId } from "../editor/ids";
import { useApiClient } from "../editor/useApiClient";

/**
 * A flat view of everything this device owns: lists, templates published from
 * them, and fills started from other people's links.
 *
 * Flat by design — the design doc defers collections and folders — and it
 * exists because the editor stopped being a single remembered document. Once a
 * template and a fill are separate lists, there has to be somewhere that shows
 * they exist.
 */
export default function ListsClient() {
  const router = useRouter();
  const connection = useApiClient(process.env.NEXT_PUBLIC_API_URL);
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connection.state !== "connected") return;
    let alive = true;
    connection.client
      .listMine()
      .then((result) => {
        if (alive) setLists(result);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [connection]);

  return (
    <div style={page}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <h1 style={{ margin: 0, fontSize: 24 }}>My lists</h1>
        <button
          type="button"
          data-testid="new-list"
          onClick={() => router.push(`/editor/${encodeURIComponent(newListId())}`)}
          style={{ ...button, marginLeft: "auto" }}
        >
          New list
        </button>
      </header>

      {connection.state === "disconnected" ? (
        <p style={muted}>Not connected to an API, so nothing is stored to list.</p>
      ) : connection.state === "failed" ? (
        <p style={warned}>Could not reach the server.</p>
      ) : error ? (
        <p style={warned} role="alert">
          {error}
        </p>
      ) : lists === null ? (
        <p style={muted}>Loading…</p>
      ) : lists.length === 0 ? (
        <p style={muted} data-testid="lists-empty">
          Nothing here yet. Make one, or open somebody&apos;s template link and fill it in.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {lists.map((list) => (
            <li key={list.id}>
              <Link href={`/editor/${encodeURIComponent(list.id)}`} style={card} data-testid="list-card">
                <span style={{ fontSize: 15 }}>{list.title || "Untitled tier list"}</span>
                <time style={{ ...muted, fontSize: 12 }} dateTime={list.updatedAt}>
                  {new Date(list.updatedAt).toLocaleString()}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const page: CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  color: "#e6edf3",
  fontFamily: "system-ui, sans-serif",
};

const card: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "12px 14px",
  background: "#12161b",
  border: "1px solid #232a33",
  borderRadius: 8,
  color: "#e6edf3",
  textDecoration: "none",
};

const button: CSSProperties = {
  background: "#222b35",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "8px 14px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
};

const muted: CSSProperties = { color: "#8b98a6", marginLeft: "auto" };
const warned: CSSProperties = { color: "#fbbf24" };
