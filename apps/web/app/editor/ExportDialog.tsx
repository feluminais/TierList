"use client";

import {
  DEFAULT_EXPORT_SETTINGS,
  type ExportPlan,
  type ExportSettings,
} from "@tl/editor-core";
import { useEffect, useMemo, useState, type CSSProperties } from "react";

export interface ExportDialogProps {
  /** What a set of settings would produce, without drawing it. */
  plan: (settings: ExportSettings) => ExportPlan;
  onExport: (settings: ExportSettings, format: "png" | "jpg") => Promise<void>;
  onClose: () => void;
  busy: boolean;
  error: string | null;
}

const SCALES = [1, 2, 3, 4];

/**
 * Chooses the shape of an exported picture.
 *
 * The picture's shape belongs to the export, not to the window the list was
 * edited in: two people on different monitors would otherwise export
 * different pictures of the same list. The person picks how many tiles sit on
 * a line, or a width; how sharp it is; and whether the tray comes along.
 *
 * It holds what was typed and passes it on as typed. `exportPlan` clamps
 * every setting, and the readout shows the size that results, so a number out
 * of range is visible as the size it turns into.
 */
export function ExportDialog({ plan, onExport, onClose, busy, error }: ExportDialogProps) {
  const [mode, setMode] = useState<"columns" | "width">("columns");
  const [columns, setColumns] = useState(6);
  const [width, setWidth] = useState(DEFAULT_EXPORT_SETTINGS.width ?? 1200);
  const [scale, setScale] = useState(DEFAULT_EXPORT_SETTINGS.scale);
  const [includeTray, setIncludeTray] = useState(DEFAULT_EXPORT_SETTINGS.includeTray);
  const [format, setFormat] = useState<"png" | "jpg">("png");

  const settings = useMemo<ExportSettings>(
    () => ({
      columns: mode === "columns" ? columns : null,
      width: mode === "width" ? width : null,
      scale,
      includeTray,
    }),
    [mode, columns, width, scale, includeTray],
  );
  const result = useMemo(() => plan(settings), [plan, settings]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div style={overlay} onClick={onClose}>
      <div
        data-testid="export-dialog"
        role="dialog"
        aria-label="Export a picture"
        onClick={(event) => event.stopPropagation()}
        style={sheet}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Export a picture</h2>
          <button
            type="button"
            aria-label="Close"
            data-testid="export-close"
            onClick={onClose}
            style={{ ...button, marginLeft: "auto", padding: "4px 10px" }}
          >
            ×
          </button>
        </div>

        <fieldset style={group}>
          <legend style={legend}>Shape</legend>
          <label style={row}>
            <input
              type="radio"
              name="export-mode"
              data-testid="export-mode-columns"
              checked={mode === "columns"}
              onChange={() => setMode("columns")}
            />
            Tiles per line
            <input
              type="number"
              data-testid="export-columns"
              aria-label="Tiles per line"
              value={columns}
              min={1}
              disabled={mode !== "columns"}
              onChange={(event) => setColumns(event.target.valueAsNumber)}
              style={{ ...field, width: 70 }}
            />
          </label>
          <label style={row}>
            <input
              type="radio"
              name="export-mode"
              data-testid="export-mode-width"
              checked={mode === "width"}
              onChange={() => setMode("width")}
            />
            Width in pixels
            <input
              type="number"
              data-testid="export-width"
              aria-label="Width in pixels"
              value={width}
              min={1}
              disabled={mode !== "width"}
              onChange={(event) => setWidth(event.target.valueAsNumber)}
              style={{ ...field, width: 90 }}
            />
          </label>
        </fieldset>

        <label style={row}>
          Sharpness
          <select
            data-testid="export-scale"
            aria-label="Sharpness"
            value={scale}
            onChange={(event) => setScale(Number(event.target.value))}
            style={field}
          >
            {SCALES.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>

        <label style={row}>
          <input
            type="checkbox"
            data-testid="export-tray"
            checked={includeTray}
            onChange={(event) => setIncludeTray(event.target.checked)}
          />
          Include the tray (items not placed yet)
        </label>

        <div style={row}>
          Format
          <label style={row}>
            <input
              type="radio"
              name="export-format"
              data-testid="export-format-png"
              checked={format === "png"}
              onChange={() => setFormat("png")}
            />
            PNG
          </label>
          <label style={row}>
            <input
              type="radio"
              name="export-format"
              data-testid="export-format-jpg"
              checked={format === "jpg"}
              onChange={() => setFormat("jpg")}
            />
            JPG
          </label>
        </div>

        <div style={{ color: "#8b98a6", fontSize: 13 }}>
          <strong data-testid="export-size" style={{ color: "#e6edf3" }}>
            {result.pixelWidth} × {result.pixelHeight} px
          </strong>
          {mode === "columns" ? null : ` · ${result.columns} tiles per line`}
          {result.scaleReduced ? (
            <div data-testid="export-reduced" style={{ color: "#fbbf24", marginTop: 4 }}>
              Sharpness lowered to {Math.round(result.scale * 100) / 100}× to keep the picture within the size a
              browser can draw.
            </div>
          ) : null}
        </div>

        {error ? (
          <span data-testid="export-error" role="alert" style={{ color: "#fbbf24" }}>
            {error}
          </span>
        ) : null}

        <button
          type="button"
          data-testid="export-go"
          disabled={busy}
          onClick={() => void onExport(settings, format)}
          style={{ ...button, opacity: busy ? 0.6 : 1, alignSelf: "flex-start" }}
        >
          {busy ? "Drawing…" : "Download"}
        </button>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 60,
};

const sheet: CSSProperties = {
  width: 420,
  maxWidth: "calc(100vw - 32px)",
  background: "#12161b",
  border: "1px solid #2c3540",
  borderRadius: 10,
  boxShadow: "0 10px 40px rgba(0,0,0,0.6)",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  color: "#e6edf3",
  fontFamily: "system-ui, sans-serif",
};

const group: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  border: "1px solid #232a33",
  borderRadius: 8,
  padding: 10,
  margin: 0,
};

const legend: CSSProperties = { color: "#8b98a6", fontSize: 12, padding: "0 4px" };
const row: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 13 };

const field: CSSProperties = {
  background: "#0b0d10",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "4px 8px",
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
