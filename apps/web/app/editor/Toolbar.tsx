"use client";

import type { EditorSession } from "@tl/editor-core";
import { useState, type CSSProperties, type FormEvent } from "react";
import type { Connection } from "./useApiClient";

export interface ToolbarProps {
  session: EditorSession;
  connection: Connection;
  onTitleChange: (title: string) => void;
  /**
   * The label alone. The id is minted by the caller, because the reducer never
   * generates ids and this is where that rule reaches the UI — a component that
   * minted its own would be the one place in the app that could.
   */
  onAddItem: (label: string) => void;
  onUndo: () => void;
  onRedo: () => void;
}

/**
 * Plain DOM chrome beside the Skia board.
 *
 * Deliberately not drawn on the canvas: Skia cannot take text input, and an
 * inline editor overlaid on a tile is its own piece of UI work with its own
 * failure modes. Inline row-label renaming is deferred for the same reason.
 */
export function Toolbar({
  session,
  connection,
  onTitleChange,
  onAddItem,
  onUndo,
  onRedo,
}: ToolbarProps) {
  const [draft, setDraft] = useState("");

  function submitItem(event: FormEvent) {
    event.preventDefault();
    const label = draft.trim();
    if (!label) return;
    onAddItem(label);
    setDraft("");
  }

  const save = saveReadout(session, connection);

  return (
    <div style={bar}>
      <input
        aria-label="List title"
        data-testid="title-input"
        value={session.doc.title}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="Untitled tier list"
        style={{ ...field, flex: "1 1 220px", fontSize: 16 }}
      />

      <form onSubmit={submitItem} style={{ display: "flex", gap: 6 }}>
        <input
          aria-label="New item"
          data-testid="item-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add an item…"
          style={{ ...field, width: 160 }}
        />
        <button type="submit" data-testid="add-item" style={button(false)}>
          Add
        </button>
      </form>

      <button
        type="button"
        data-testid="undo"
        onClick={onUndo}
        disabled={!session.canUndo}
        style={button(!session.canUndo)}
      >
        Undo
      </button>
      <button
        type="button"
        data-testid="redo"
        onClick={onRedo}
        disabled={!session.canRedo}
        style={button(!session.canRedo)}
      >
        Redo
      </button>

      <span
        data-testid="save-status"
        data-save-state={save.key}
        role={save.key === "conflict" ? "alert" : undefined}
        style={{ ...readout, ...save.style }}
      >
        {save.text}
      </span>
    </div>
  );
}

interface Readout {
  key: string;
  text: string;
  style: CSSProperties;
}

/**
 * The one place the connection and the save state are folded together.
 *
 * `conflict` is the only state that means the user's work is *not going to be*
 * saved — 2D surfaces a conflict and stops writing, and nothing currently
 * clears it — so it gets a treatment nothing else has. `disconnected` is the
 * other honest failure to say out loud, and it is the state this route is
 * normally in, because no API has ever run against a real database here.
 */
function saveReadout(session: EditorSession, connection: Connection): Readout {
  if (connection.state === "disconnected") {
    return { key: "disconnected", text: "Not connected — nothing is saved", style: muted };
  }
  if (connection.state === "connecting") {
    return { key: "connecting", text: "Connecting…", style: muted };
  }
  if (connection.state === "failed") {
    return {
      key: "unreachable",
      text: "Not connected — server unreachable",
      style: warned,
    };
  }

  switch (session.status) {
    case "saved":
      return { key: "saved", text: "Saved", style: calm };
    case "dirty":
      return { key: "dirty", text: "Unsaved changes", style: muted };
    case "saving":
      return { key: "saving", text: "Saving…", style: muted };
    case "error":
      return { key: "error", text: "Save failed — retrying", style: warned };
    case "conflict":
      return {
        key: "conflict",
        text: "Conflict — edited elsewhere. Nothing is being saved.",
        style: alarmed,
      };
  }
}

const bar: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
  padding: 10,
  marginBottom: 12,
  background: "#12161b",
  border: "1px solid #232a33",
  borderRadius: 8,
  color: "#e6edf3",
  fontFamily: "system-ui, sans-serif",
};

const field: CSSProperties = {
  background: "#0b0d10",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "6px 8px",
  fontFamily: "inherit",
};

function button(disabled: boolean): CSSProperties {
  return {
    background: disabled ? "#171c22" : "#222b35",
    border: "1px solid #2c3540",
    borderRadius: 6,
    color: disabled ? "#5b6673" : "#e6edf3",
    padding: "6px 12px",
    cursor: disabled ? "default" : "pointer",
    fontFamily: "inherit",
  };
}

const readout: CSSProperties = {
  marginLeft: "auto",
  padding: "6px 10px",
  borderRadius: 6,
  fontSize: 13,
};

const muted: CSSProperties = { color: "#8b98a6" };
const calm: CSSProperties = { color: "#4ade80" };
const warned: CSSProperties = { color: "#fbbf24" };
const alarmed: CSSProperties = {
  color: "#0b0d10",
  background: "#f87171",
  fontWeight: 700,
};
