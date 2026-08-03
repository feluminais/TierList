"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type FormEvent } from "react";

/**
 * Search, as a link.
 *
 * The query lives in the URL rather than in state so a result page can be
 * shared, bookmarked and indexed — which is the whole point of the browse
 * surface. That also means the page itself stays a server component and this
 * is the only client JavaScript on it.
 */
export function SearchBox({ category, initial }: { category?: string; initial?: string }) {
  const router = useRouter();
  const [text, setText] = useState(initial ?? "");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const base = category ? `/browse/${encodeURIComponent(category)}` : "/browse";
    const trimmed = text.trim();
    router.push(trimmed ? `${base}?q=${encodeURIComponent(trimmed)}` : base);
  };

  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 6, marginBottom: 20 }}>
      <input
        aria-label="Search tier lists"
        data-testid="browse-search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Search by title…"
        style={field}
      />
      <button type="submit" data-testid="browse-search-submit" style={button}>
        Search
      </button>
    </form>
  );
}

const field: CSSProperties = {
  flex: "1 1 240px",
  maxWidth: 360,
  background: "#0b0d10",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "8px 10px",
  fontFamily: "inherit",
  fontSize: 13,
};

const button: CSSProperties = {
  background: "#222b35",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "8px 16px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
};
