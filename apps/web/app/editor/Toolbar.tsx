"use client";

import type { TileAspect } from "@tl/core";
import type { EditorSession } from "@tl/editor-core";
import { useState, type CSSProperties, type FormEvent } from "react";
import type { Connection } from "./useApiClient";

/** "All rows" — the global `display.tileSize` rather than any one row. */
const GLOBAL = "";

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
  /** Current global tile size, and how to change it. */
  tileSize: number;
  onTileSize: (size: number) => void;
  /**
   * Per-row override. `null` clears it, returning the row to `tileSize`.
   *
   * The agreed shape for tile scaling was "a toolbar control **plus** a
   * per-row override", and only the global half shipped. Both live on one
   * slider here rather than two: which one it drives is a choice the user
   * makes in the selector beside it, and a second slider that looked
   * identical and meant something else is how the two get confused.
   */
  onRowTileSize: (rowId: string, size: number | null) => void;
  onTileAspect: (aspect: TileAspect) => void;
  /** Export handlers. Null while the canvas has not loaded and cannot snapshot. */
  onExportImage: ((format: "png" | "jpg") => void) | null;
  onExportJson: () => void;
  onShare: (() => void) | null;
  sharing: boolean;
  shareUrl: string | null;
  shareError: string | null;
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
  onAddImage,
  uploading,
  uploadError,
  tileSize,
  onTileSize,
  onRowTileSize,
  onTileAspect,
  onExportImage,
  onExportJson,
  onShare,
  sharing,
  shareUrl,
  shareError,
}: ToolbarProps) {
  const [draft, setDraft] = useState("");
  /** Which row the size slider drives, or `GLOBAL` for `display.tileSize`. */
  const [sizeTarget, setSizeTarget] = useState<string>(GLOBAL);

  const rows = [...session.doc.rows].sort((a, b) => a.order - b.order);
  // A row can be removed while it is selected. Falling back to the global
  // target keeps the slider driving something real rather than emitting
  // actions against an id the document no longer has, which the reducer would
  // silently ignore — a slider that moves and changes nothing.
  const targetRow = rows.find((r) => r.id === sizeTarget) ?? null;
  const effectiveTarget = targetRow ? sizeTarget : GLOBAL;
  const sliderValue = targetRow ? (targetRow.tileSizeOverride ?? tileSize) : tileSize;

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
        <select
          aria-label="Tile size applies to"
          data-testid="tile-size-target"
          value={effectiveTarget}
          onChange={(event) => setSizeTarget(event.target.value)}
          style={field}
        >
          <option value={GLOBAL}>All rows</option>
          {rows.map((row) => (
            <option key={row.id} value={row.id}>
              {row.label || "(unnamed)"}
              {row.tileSizeOverride === undefined ? "" : " ✓"}
            </option>
          ))}
        </select>
        <input
          aria-label="Tile size"
          data-testid="tile-size"
          type="range"
          min={48}
          max={200}
          step={4}
          value={sliderValue}
          onChange={(event) => {
            const size = Number(event.target.value);
            if (targetRow) onRowTileSize(targetRow.id, size);
            else onTileSize(size);
          }}
        />
        {targetRow && targetRow.tileSizeOverride !== undefined ? (
          <button
            type="button"
            data-testid="tile-size-reset"
            title="Use the list's tile size for this row"
            onClick={() => onRowTileSize(targetRow.id, null)}
            style={button(false)}
          >
            Reset
          </button>
        ) : null}
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
        disabled={!onShare || sharing}
        style={button(!onShare || sharing)}
        title="Create a public link"
      >
        {sharing ? "Sharing…" : "Share"}
      </button>

      {shareUrl ? (
        <input
          aria-label="Share link"
          data-testid="share-url"
          readOnly
          value={shareUrl}
          onFocus={(event) => event.target.select()}
          style={{ ...field, width: 260, fontSize: 12 }}
        />
      ) : null}

      {shareError ? (
        <span data-testid="share-error" role="alert" style={{ ...readout, ...warned }}>
          {shareError}
        </span>
      ) : null}

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
