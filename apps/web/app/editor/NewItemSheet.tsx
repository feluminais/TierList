"use client";

import { DOCUMENT_LIMITS } from "@tl/core";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";

export interface NewItemSheetProps {
  /** Uploads the picked file and adds an image item. */
  onAddImage: (file: File) => void;
  /** Adds a text item with this label. */
  onAddText: (label: string) => void;
  uploading: boolean;
  error: string | null;
  onClose: () => void;
}

/**
 * The sheet behind the tray's `+`.
 *
 * One entry point for adding anything, rather than a text field and a file
 * button side by side in the toolbar: what the user wants is "another item",
 * and which kind it is follows from what they give it.
 *
 * Deliberately a full-bleed dark surface. This is the shell of the item editor
 * — a picked image will eventually land here to be cropped, drawn on and
 * coloured before it is added, rather than going straight to the board — so it
 * is shaped like a canvas from the start. See `docs/superpowers/BACKLOG.md`
 * for what it grows into.
 */
export function NewItemSheet({
  onAddImage,
  onAddText,
  uploading,
  error,
  onClose,
}: NewItemSheetProps) {
  const [label, setLabel] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const textRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => textRef.current?.focus(), []);

  const submitText = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = label.trim();
    if (!trimmed) return;
    onAddText(trimmed);
    setLabel("");
    onClose();
  };

  const takeFile = (file: File | undefined) => {
    if (!file) return;
    onAddImage(file);
    onClose();
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div
        data-testid="new-item-sheet"
        role="dialog"
        aria-label="Add an item"
        onClick={(event) => event.stopPropagation()}
        style={sheet}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Add an item</h2>
          <button
            type="button"
            aria-label="Close"
            data-testid="new-item-close"
            onClick={onClose}
            style={{ ...button, marginLeft: "auto", padding: "4px 10px" }}
          >
            ×
          </button>
        </div>

        <button
          type="button"
          data-testid="new-item-pick-image"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            takeFile(event.dataTransfer.files?.[0]);
          }}
          style={dropZone(dragOver, uploading)}
        >
          <span style={{ fontSize: 34, lineHeight: 1 }}>+</span>
          <span>{uploading ? "Uploading…" : "Choose an image, or drop one here"}</span>
          <span style={{ color: "#5b6673", fontSize: 12 }}>PNG, JPEG or WebP</span>
        </button>

        <input
          ref={fileRef}
          type="file"
          data-testid="new-item-file"
          accept="image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so picking the same file twice still fires a change
            // event — the second pick is otherwise silently ignored.
            event.target.value = "";
            takeFile(file);
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#5b6673" }}>
          <span style={rule} />
          or
          <span style={rule} />
        </div>

        <form onSubmit={submitText} style={{ display: "flex", gap: 6 }}>
          <input
            ref={textRef}
            aria-label="Item name"
            data-testid="new-item-label"
            value={label}
            maxLength={DOCUMENT_LIMITS.itemLabelLength}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Add it by name instead…"
            style={{ ...field, flex: 1 }}
          />
          <button
            type="submit"
            data-testid="new-item-add-text"
            disabled={!label.trim()}
            style={{ ...button, opacity: label.trim() ? 1 : 0.5 }}
          >
            Add
          </button>
        </form>

        {error ? (
          <span data-testid="new-item-error" role="alert" style={{ color: "#fbbf24", fontSize: 13 }}>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.78)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
};

const sheet: CSSProperties = {
  width: 460,
  maxWidth: "calc(100vw - 32px)",
  background: "#0b0d10",
  border: "1px solid #2c3540",
  borderRadius: 12,
  boxShadow: "0 10px 40px rgba(0,0,0,0.7)",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  color: "#e6edf3",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
};

function dropZone(active: boolean, uploading: boolean): CSSProperties {
  return {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: "34px 16px",
    background: active ? "rgba(59,139,235,0.12)" : "#12161b",
    border: `2px dashed ${active ? "#3b8beb" : "#2c3540"}`,
    borderRadius: 10,
    color: "#8b98a6",
    cursor: uploading ? "default" : "pointer",
    fontFamily: "inherit",
    fontSize: 14,
    transition: "background 120ms ease-out, border-color 120ms ease-out",
  };
}

const rule: CSSProperties = { flex: 1, height: 1, background: "#232a33" };

const field: CSSProperties = {
  background: "#12161b",
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
  padding: "8px 14px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
};
