"use client";

import { createClient, type Client } from "@tl/api-client";
import { startFill, type TierList } from "@tl/core";
import { useRouter } from "next/navigation";
import { useState, type CSSProperties } from "react";
import { newListId } from "../../editor/ids";
import { TOKEN_STORAGE_KEY } from "../../editor/useApiClient";

export interface FillButtonProps {
  /** The shared document, already fetched and migrated by the page. */
  source: TierList;
  baseUrl: string;
}

/**
 * "Fill this in" — the one button the whole milestone is for.
 *
 * A reader arrives holding nothing: no list, and usually no device token
 * either. Pressing this mints a token if they need one, copies the tiers and
 * items into a *new* list of their own with everything in the tray, and opens
 * the editor on it. The list they came from is untouched, which is what makes
 * it safe to hand the same link to any number of people.
 *
 * `startFill` stamps `templateId` and `templateRevision`, recording which
 * document and which revision of it this was ranked against. Neither can be
 * reconstructed afterwards — both sides keep changing — so comparison depends
 * on them being written here, at the moment the copy is taken.
 *
 * A client component on an otherwise server-rendered page: it is the only part
 * that needs a token, a write and a navigation, and keeping it to one button
 * leaves the page itself free of client JavaScript.
 */
export function FillButton({ source, baseUrl }: FillButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fill = async () => {
    setError(null);
    setBusy(true);
    try {
      const client = await connect(baseUrl);
      const id = newListId();
      await client.createList(startFill(source, { id, now: new Date().toISOString() }));
      // Not `replace`: Back should return to the template, which is where the
      // reader came from and may want to look at again.
      router.push(`/editor/${encodeURIComponent(id)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
    // Deliberately no `setBusy(false)` on success: the navigation is under way
    // and re-enabling the button would invite a second fill on the way out.
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        data-testid="fill-this-in"
        onClick={() => void fill()}
        disabled={busy}
        style={{ ...button, opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "Setting up your copy…" : "Fill this in yourself"}
      </button>
      <span style={{ color: "#8b98a6", fontSize: 13 }}>
        You get your own copy to rank. This one stays as it is.
      </span>
      {error ? (
        <span data-testid="fill-error" role="alert" style={{ color: "#fbbf24", fontSize: 13 }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A client carrying this browser's device token, minting one if this is the
 * reader's first write.
 *
 * Reads the same `localStorage` key the editor's own bootstrap uses, so a
 * reader who fills something in and later opens the editor is the same owner
 * and sees the list they made. Writing here rather than reusing `useApiClient`
 * because that hook probes and connects on mount, and this page must cost
 * nothing until the button is actually pressed.
 */
async function connect(baseUrl: string): Promise<Client> {
  const doFetch = globalThis.fetch.bind(globalThis);
  let token: string | undefined;
  try {
    token = window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined;
  } catch {
    // Storage can throw under some privacy settings; mint a fresh token and
    // accept that this fill will not be reclaimable on a later visit.
  }

  if (!token) {
    const minted = await createClient({ baseUrl, fetch: doFetch }).mintToken();
    token = minted.token;
    try {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch {
      // As above.
    }
  }

  return createClient({ baseUrl, token, fetch: doFetch });
}

const button: CSSProperties = {
  background: "#3b8beb",
  border: "1px solid #3b8beb",
  borderRadius: 8,
  color: "#08121c",
  padding: "10px 18px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};
