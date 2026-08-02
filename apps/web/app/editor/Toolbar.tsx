"use client";

import type { TileAspect } from "@tl/core";
import type { EditorSession } from "@tl/editor-core";
import Link from "next/link";
import { useState, type CSSProperties, type FormEvent } from "react";
import type { Connection } from "./useApiClient";

const ASPECTS: { value: TileAspect; label: string }[] = [
  { value: "square", label: "Square" },
  { value: "portrait", label: "Portrait" },
  { value: "landscape", label: "Landscape" },
];

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
  /** The file alone. Uploading it and minting the item id both live at the
   *  call site, for the same reason `onAddItem` only takes a label. */
  onAddImage: (file: File) => void;
  uploading: boolean;
  uploadError: string | null;
  /**
   * The list-wide tile size, which every row without an override renders at.
   * Per-tier overrides live in `TierControls`, beside the rest of what acts on
   * one tier.
   */
  tileSize: number;
  onTileSize: (size: number) => void;
  onTileAspect: (aspect: TileAspect) => void;
  /** Export handlers. Null while the canvas has not loaded and cannot snapshot. */
  onExportImage: ((format: "png" | "jpg") => void) | null;
  onExportJson: () => void;
  /** Opens the share dialog. Null while there is no API to share against. */
  onShare: (() => void) | null;
}

/**
 * Plain DOM chrome beside the Skia board, for everything that acts on the list
 * as a whole. What acts on one tier lives in `TierControls`.
 *
 * Not drawn on the canvas: Skia takes no text input, so every field here would
 * otherwise be a DOM overlay tracking a canvas rectangle.
 */
export function Toolbar({
  session,
  connection,
  onTitleChange,
  onAddItem,
  onUndo,
  onRedo,
  onAddImage,
  uploading,
  uploadError,
  tileSize,
  onTileSize,
  onTileAspect,
  onExportImage,
  onExportJson,
  onShare,
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
      <Link
        href="/lists"
        data-testid="my-lists"
        title="Every list this browser owns"
        style={{ ...button(false), textDecoration: "none", display: "inline-block" }}
      >
        My lists
      </Link>

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

      <label style={{ ...button(uploading), display: "inline-block", cursor: uploading ? "default" : "pointer" }}>
        {uploading ? "Uploading…" : "Add image"}
        <input
          type="file"
          data-testid="add-image"
          accept="image/png,image/jpeg,image/webp"
          disabled={uploading}
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so picking the same file twice still fires a change
            // event — the second pick is otherwise silently ignored.
            event.target.value = "";
            if (file) onAddImage(file);
          }}
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#888" }}>
        Tile
        <input
          aria-label="Tile size"
          data-testid="tile-size"
          type="range"
          min={48}
          max={200}
          step={4}
          value={tileSize}
          onChange={(event) => onTileSize(Number(event.target.value))}
        />
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#888" }}>
        Shape
        <select
          aria-label="Tile shape"
          data-testid="tile-aspect"
          value={session.doc.display.tileAspect}
          onChange={(event) => onTileAspect(event.target.value as TileAspect)}
          style={field}
        >
          {ASPECTS.map((a) => (
            <option key={a.value} value={a.value}>
              {a.label}
            </option>
          ))}
        </select>
      </label>

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

      <button
        type="button"
        data-testid="export-png"
        onClick={() => onExportImage?.("png")}
        disabled={!onExportImage}
        style={button(!onExportImage)}
        title="Download the board as a PNG"
      >
        PNG
      </button>
      <button
        type="button"
        data-testid="export-jpg"
        onClick={() => onExportImage?.("jpg")}
        disabled={!onExportImage}
        style={button(!onExportImage)}
        title="Download the board as a JPG"
      >
        JPG
      </button>
      <button
        type="button"
        data-testid="export-json"
        onClick={onExportJson}
        style={button(false)}
        title="Download the document — the answer to “it's just a picture”"
      >
        JSON
      </button>
      <button
        type="button"
        data-testid="share"
        onClick={() => onShare?.()}
        disabled={!onShare}
        style={button(!onShare)}
        title="Share a link, or publish a template others can fill"
      >
        Share
      </button>

      {uploadError ? (
        <span data-testid="upload-error" role="alert" style={{ ...readout, ...warned }}>
          {uploadError}
        </span>
      ) : null}

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
 * `conflict` is the only state meaning the user's work is *not going to be*
 * saved: a conflicted session stops writing and nothing clears it. That earns
 * a treatment nothing else has. `disconnected` is the other failure worth
 * saying out loud, and it is the normal state of this route when no API is
 * configured.
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
