"use client";

import { useRouter } from "next/navigation";
import { useState, type CSSProperties, type FormEvent } from "react";

/**
 * The codes being compared, and a field to add another.
 *
 * The codes live in the URL rather than in component state, so a comparison is
 * a link: it can be pasted back into the chat it came from and opens the same
 * result. That is also what makes "compare with me" work — it is this page
 * with one code already in the query.
 */
export function CodeBar({ codes }: { codes: string[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");

  const goTo = (next: string[]) => {
    const unique = [...new Set(next.filter(Boolean))];
    router.push(unique.length ? `/compare?codes=${unique.join(",")}` : "/compare");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // Accept a whole pasted link as well as a bare code — the thing a reader
    // actually has to hand is the URL somebody sent them.
    const typed = draft.trim().replace(/^.*\/l\//, "").replace(/[?#].*$/, "");
    if (!typed) return;
    setDraft("");
    goTo([...codes, typed.toUpperCase()]);
  };

  return (
    <div style={bar}>
      {codes.map((code) => (
        <span key={code} style={chip} data-testid="compare-code">
          {code}
          <button
            type="button"
            aria-label={`Remove ${code}`}
            data-testid="compare-remove"
            onClick={() => goTo(codes.filter((c) => c !== code))}
            style={remove}
          >
            ×
          </button>
        </span>
      ))}

      <form onSubmit={submit} style={{ display: "flex", gap: 6 }}>
        <input
          aria-label="Share code or link"
          data-testid="compare-add-code"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Paste a share link or code…"
          style={field}
        />
        <button type="submit" data-testid="compare-add" style={button}>
          Add
        </button>
      </form>
    </div>
  );
}

const bar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  marginBottom: 20,
};

const chip: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "5px 6px 5px 10px",
  background: "#12161b",
  border: "1px solid #2c3540",
  borderRadius: 999,
  fontFamily: "monospace",
  fontSize: 13,
};

const remove: CSSProperties = {
  background: "none",
  border: "none",
  color: "#8b98a6",
  cursor: "pointer",
  fontSize: 15,
  lineHeight: 1,
  padding: "0 2px",
};

const field: CSSProperties = {
  background: "#0b0d10",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "7px 10px",
  fontFamily: "inherit",
  fontSize: 13,
  width: 240,
};

const button: CSSProperties = {
  background: "#222b35",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "7px 14px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
};
