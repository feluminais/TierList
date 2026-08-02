"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

export interface ShareDialogProps {
  /** Creates (or re-fetches) the read-only link to this list. */
  onShareView: () => void;
  viewUrl: string | null;
  /** Publishes a template others can fill, and returns its link. */
  onShareTemplate: () => void;
  templateUrl: string | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
}

/**
 * One place to hand this list to somebody.
 *
 * Two links rather than one, because they are different offers and a single
 * "Share" would have to pick for the user: a **view** link shows the list as it
 * stands, and a **template** link invites the reader to fill it in themselves.
 * The second is what closes the product's loop, so it is stated as plainly as
 * the first rather than hidden behind the word "share".
 *
 * A template is a *snapshot*: publishing takes the rows and items as they are
 * now and freezes them into their own list. Editing this list afterwards does
 * not change a template already handed out, which is what stops a friend's
 * half-finished fill from having items appear and vanish under them.
 */
export function ShareDialog({
  onShareView,
  viewUrl,
  onShareTemplate,
  templateUrl,
  busy,
  error,
  onClose,
}: ShareDialogProps) {
  const ref = useRef<HTMLDivElement | null>(null);

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
        ref={ref}
        data-testid="share-dialog"
        role="dialog"
        aria-label="Share"
        // The backdrop closes; a click that started inside must not.
        onClick={(event) => event.stopPropagation()}
        style={sheet}
      >
        <div style={{ display: "flex", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Share</h2>
          <button
            type="button"
            aria-label="Close"
            data-testid="share-dialog-close"
            onClick={onClose}
            style={{ ...button, marginLeft: "auto", padding: "4px 10px" }}
          >
            ×
          </button>
        </div>

        <Offer
          title="Anyone with the link can view"
          detail="A page showing this list as it is now."
          actionLabel="Create view link"
          testId="view"
          url={viewUrl}
          busy={busy}
          onCreate={onShareView}
        />

        <Offer
          title="Let others fill it in"
          detail="Publishes the tiers and items as a template. Everyone who opens it gets their own copy to rank, and yours is untouched."
          actionLabel="Create template link"
          testId="template"
          url={templateUrl}
          busy={busy}
          onCreate={onShareTemplate}
        />

        {error ? (
          <span data-testid="share-dialog-error" role="alert" style={{ color: "#fbbf24" }}>
            {error}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function Offer({
  title,
  detail,
  actionLabel,
  testId,
  url,
  busy,
  onCreate,
}: {
  title: string;
  detail: string;
  actionLabel: string;
  testId: string;
  url: string | null;
  busy: boolean;
  onCreate: () => void;
}) {
  const [copied, setCopied] = useState(false);

  // Reset when the link changes, so a fresh link does not inherit the previous
  // one's "Copied" state and claim it is already on the clipboard.
  useEffect(() => setCopied(false), [url]);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard access can be refused, and there is nothing to do about it —
      // the link is on screen and selectable, which is the fallback.
    }
  };

  return (
    <section style={offer}>
      <strong style={{ fontSize: 14 }}>{title}</strong>
      <p style={{ margin: 0, color: "#8b98a6", fontSize: 12 }}>{detail}</p>
      {url ? (
        <div style={{ display: "flex", gap: 6 }}>
          <input
            readOnly
            aria-label={`${title} link`}
            data-testid={`share-url-${testId}`}
            value={url}
            onFocus={(event) => event.target.select()}
            style={{ ...field, flex: 1 }}
          />
          <button
            type="button"
            data-testid={`share-copy-${testId}`}
            onClick={copy}
            style={button}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          data-testid={`share-create-${testId}`}
          onClick={onCreate}
          disabled={busy}
          style={{ ...button, opacity: busy ? 0.6 : 1, alignSelf: "flex-start" }}
        >
          {busy ? "Working…" : actionLabel}
        </button>
      )}
    </section>
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
  width: 460,
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

const offer: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  padding: 12,
  background: "#0e1216",
  border: "1px solid #232a33",
  borderRadius: 8,
};

const field: CSSProperties = {
  background: "#0b0d10",
  border: "1px solid #2c3540",
  borderRadius: 6,
  color: "#e6edf3",
  padding: "6px 8px",
  fontFamily: "inherit",
  fontSize: 12,
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
