"use client";

import type { CSSProperties } from "react";

export interface ContextBannerProps {
  lost: boolean;
  stalled: boolean;
  onRecreate: () => void;
}

/**
 * What the person sees while the browser has taken the display away.
 *
 * Quiet while it is likely to come back by itself, and an action only once it
 * has not: the list is safe either way, since it lives in the session and not
 * in the canvas, and the banner says so.
 */
export function ContextBanner({ lost, stalled, onRecreate }: ContextBannerProps) {
  if (!lost) return null;
  return (
    <div data-testid="context-banner" role="status" style={banner}>
      <span>
        {stalled
          ? "The display could not recover on its own. Your list is safe."
          : "Recovering the display…"}
      </span>
      {stalled ? (
        <button type="button" data-testid="context-recreate" onClick={onRecreate} style={button}>
          Redraw
        </button>
      ) : null}
    </div>
  );
}

const banner: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  margin: "0 0 12px",
  padding: "8px 12px",
  background: "#2a2310",
  border: "1px solid #6b5a1a",
  borderRadius: 8,
  color: "#fbbf24",
  fontFamily: "system-ui, sans-serif",
  fontSize: 13,
};

const button: CSSProperties = {
  background: "#222b35",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "4px 10px",
  cursor: "pointer",
  fontFamily: "inherit",
  fontSize: 13,
};
