"use client";

import { createClient, type ReportReason } from "@tl/api-client";
import { useRef, useState, type CSSProperties } from "react";

export interface ReportButtonProps {
  code: string;
  baseUrl: string;
}

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "illegal", label: "Illegal content" },
  { value: "abuse", label: "Abuse or hate" },
  { value: "copyright", label: "Copyright" },
  { value: "spam", label: "Spam" },
  { value: "other", label: "Something else" },
];

/** What the server accepts in a note; the field stops there so it cannot be exceeded. */
const MAX_NOTE_LENGTH = 500;

/**
 * "Report this list" — a quiet link that opens a small form.
 *
 * The page is public and its reader usually holds no account or token, and a
 * report needs neither: the endpoint is anonymous and rate-limited. A reader
 * who sees something that should not be public has been sent a link to it, and
 * that is all they are asked to hold.
 *
 * A client component on an otherwise server-rendered page, for the same
 * reason as `FillButton`: it is the only part that needs state and a request.
 */
export function ReportButton({ code, baseUrl }: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("other");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set synchronously, so two clicks inside one render cannot both send.
  const inFlight = useRef(false);

  if (sent) {
    return (
      <p data-testid="report-thanks" style={{ ...muted, margin: 0 }}>
        Thanks — the report was sent.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" data-testid="report-open" onClick={() => setOpen(true)} style={link}>
        Report this list
      </button>
    );
  }

  const submit = async () => {
    // A disabled button stops a second click only after the next render.
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const client = createClient({ baseUrl, fetch: globalThis.fetch.bind(globalThis) });
      const trimmed = note.trim();
      await client.reportShare({
        code,
        reason,
        ...(trimmed ? { note: trimmed } : {}),
      });
      setSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <div data-testid="report-form" style={form}>
      <label style={label}>
        Why
        <select
          data-testid="report-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value as ReportReason)}
          style={field}
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <label style={label}>
        Details (optional)
        <textarea
          data-testid="report-note"
          value={note}
          maxLength={MAX_NOTE_LENGTH}
          rows={3}
          onChange={(event) => setNote(event.target.value)}
          style={{ ...field, resize: "vertical" }}
        />
      </label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          type="button"
          data-testid="report-send"
          onClick={() => void submit()}
          disabled={busy}
          style={{ ...button, opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Sending…" : "Send report"}
        </button>
        <button type="button" data-testid="report-cancel" onClick={() => setOpen(false)} style={button}>
          Cancel
        </button>
        {error ? (
          <span data-testid="report-error" role="alert" style={{ color: "#fbbf24", fontSize: 13 }}>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const muted: CSSProperties = { color: "#8b98a6", fontSize: 13 };

const link: CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#8b98a6",
  fontFamily: "inherit",
  fontSize: 13,
  textDecoration: "underline",
  cursor: "pointer",
};

const form: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  maxWidth: 420,
  padding: 12,
  background: "#12161b",
  border: "1px solid #232a33",
  borderRadius: 8,
};

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, color: "#8b98a6", fontSize: 12 };

const field: CSSProperties = {
  background: "#0b0d10",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "6px 8px",
  fontFamily: "inherit",
  fontSize: 13,
};

const button: CSSProperties = {
  background: "#222b35",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "6px 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
};
