"use client";

import { CATEGORIES, DOCUMENT_LIMITS } from "@tl/core";
import type { EditorSession } from "@tl/editor-core";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Connection } from "@tl/app-core";

export interface ToolbarProps {
  session: EditorSession;
  connection: Connection;
  onTitleChange: (title: string) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Surfaced here because an upload has no other place to report from. */
  uploadError: string | null;
  /** Export handlers. Null while the canvas has not loaded and cannot snapshot. */
  onExportImage: ((format: "png" | "jpg") => void) | null;
  onExportJson: () => void;
  /** Opens the share dialog. Null while there is no API to share against. */
  onShare: (() => void) | null;
  /** Puts the pen out for drawing across the whole list. */
  onAnnotate: () => void;
  /**
   * Files the list under a category. `null` clears it.
   *
   * The taxonomy is closed, and this is the only thing that writes
   * `categoryId` — a browse page is only useful if two people filing the same
   * kind of list pick the same one, which free text cannot deliver.
   */
  onCategory: (categoryId: string | null) => void;
  /**
   * Sets the free-form tags. Takes the raw comma-separated text, because the
   * cleaning is `normalizeTags`' job and doing it in two places is how the
   * stored form and the searched form drift apart.
   */
  onTags: (text: string) => void;
  /**
   * True until the list has been read from the server. The session meanwhile
   * holds a placeholder, whose save state describes nothing real.
   */
  loading?: boolean;
  /** Opens the export dialog, where the picture's shape is chosen. Null while there is no canvas. */
  onExportOptions?: (() => void) | null;
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
  onUndo,
  onRedo,
  uploadError,
  onExportImage,
  onExportJson,
  onShare,
  onAnnotate,
  onCategory,
  onTags,
  loading = false,
  onExportOptions = null,
}: ToolbarProps) {
  const save = saveReadout(session, connection, loading);
  // Until the list has loaded this is a placeholder for a document that has not
  // arrived: nothing that edits, exports or shares it means anything yet.
  // Leaving for "My lists" is the one thing that stays available.
  const undoOff = loading || !session.canUndo;
  const redoOff = loading || !session.canRedo;
  const exportOff = loading || !onExportImage;
  const exportOptionsOff = loading || !onExportOptions;
  const shareOff = loading || !onShare;

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
        maxLength={DOCUMENT_LIMITS.titleLength}
        disabled={loading}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="Untitled tier list"
        style={{ ...field, flex: "1 1 220px", fontSize: 16 }}
      />

      <button
        type="button"
        data-testid="undo"
        onClick={onUndo}
        disabled={undoOff}
        style={button(undoOff)}
      >
        Undo
      </button>
      <button
        type="button"
        data-testid="redo"
        onClick={onRedo}
        disabled={redoOff}
        style={button(redoOff)}
      >
        Redo
      </button>

      <button
        type="button"
        data-testid="export-png"
        onClick={() => onExportImage?.("png")}
        disabled={exportOff}
        style={button(exportOff)}
        title="Download the board as a PNG"
      >
        PNG
      </button>
      <button
        type="button"
        data-testid="export-jpg"
        onClick={() => onExportImage?.("jpg")}
        disabled={exportOff}
        style={button(exportOff)}
        title="Download the board as a JPG"
      >
        JPG
      </button>
      <button
        type="button"
        data-testid="export-options"
        onClick={() => onExportOptions?.()}
        disabled={exportOptionsOff}
        style={button(exportOptionsOff)}
        title="Choose the picture's width, tiles per line, sharpness and whether the tray is in it"
      >
        Export…
      </button>
      <button
        type="button"
        data-testid="export-json"
        onClick={onExportJson}
        disabled={loading}
        style={button(loading)}
        title="Download the document — the answer to “it's just a picture”"
      >
        JSON
      </button>
      <label style={{ display: "flex", alignItems: "center", gap: 6, color: "#888" }}>
        Category
        <select
          aria-label="Category"
          data-testid="category"
          value={session.doc.categoryId ?? ""}
          disabled={loading}
          onChange={(event) => onCategory(event.target.value || null)}
          style={field}
        >
          <option value="">Uncategorised</option>
          {CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <input
        aria-label="Tags"
        data-testid="tags-input"
        defaultValue={session.doc.tags.join(", ")}
        disabled={loading}
        // Uncontrolled, and committed on blur rather than per keystroke:
        // `normalizeTags` drops empties and lowercases, so feeding its output
        // back into a controlled field would eat the comma the moment it was
        // typed.
        onBlur={(event) => onTags(event.target.value)}
        placeholder="tags, comma separated"
        style={{ ...field, flex: "0 1 200px" }}
        title="Free-form tags — anything the category cannot say"
      />

      <button
        type="button"
        data-testid="annotate"
        onClick={onAnnotate}
        disabled={loading}
        style={button(loading)}
        title="Draw across the whole list"
      >
        Annotate
      </button>
      <button
        type="button"
        data-testid="share"
        onClick={() => onShare?.()}
        disabled={shareOff}
        style={button(shareOff)}
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
        role={save.key === "conflict" || save.key === "rejected" ? "alert" : undefined}
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
 * `conflict` and `rejected` are the only states meaning the user's work is *not
 * going to be* saved: such a session stops writing and nothing clears it. That
 * earns a treatment nothing else has. `disconnected` is the other failure worth
 * saying out loud, and it is the normal state of this route when no API is
 * configured.
 */
function saveReadout(session: EditorSession, connection: Connection, loading: boolean): Readout {
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
  if (loading) {
    return { key: "loading", text: "Loading…", style: muted };
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
    case "rejected":
      return {
        key: "rejected",
        text: "The server refused this list. Nothing is being saved; your edits stay on this device.",
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
