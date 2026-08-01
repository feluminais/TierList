"use client";

import { createClient, type Client } from "@tl/api-client";
import { useEffect, useRef, useState } from "react";

/**
 * Where the anonymous device token is kept between visits.
 *
 * Minting a fresh one on every load would orphan every list the previous token
 * owned, because writes are ownership-scoped (see the 1D plan).
 */
export const TOKEN_STORAGE_KEY = "tl.deviceToken";

/**
 * What the editor knows about the server.
 *
 * `disconnected` is not an error. No API runs in development by default and no
 * real Postgres has ever been connected to this project, so the honest thing
 * for an unset `NEXT_PUBLIC_API_URL` is to say nothing is being saved — not to
 * show a failure, and certainly not to show a success.
 */
export type Connection =
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "connected"; client: Client }
  | { state: "failed"; reason: string };

export interface ApiClientIo {
  fetch?: typeof globalThis.fetch;
  storage?: Pick<Storage, "getItem" | "setItem">;
}

/**
 * Resolves a base URL into a ready-to-use client, minting and remembering an
 * anonymous device token on the way.
 *
 * Read through a ref rather than the dependency array so an inline `io` object
 * cannot restart the bootstrap on every render.
 */
export function useApiClient(
  baseUrl: string | undefined,
  io: ApiClientIo = {},
): Connection {
  const ioRef = useRef(io);
  useEffect(() => {
    ioRef.current = io;
  });

  const [connection, setConnection] = useState<Connection>(() =>
    baseUrl ? { state: "connecting" } : { state: "disconnected" },
  );

  useEffect(() => {
    if (!baseUrl) {
      setConnection({ state: "disconnected" });
      return;
    }

    let alive = true;
    setConnection({ state: "connecting" });

    void (async () => {
      // Bound, because an unbound `fetch` throws "Illegal invocation" in a
      // browser. `bind` rather than a wrapping arrow so the overloaded call
      // signature survives — apps/web sees both the DOM and the @types/node
      // declarations of `fetch`, and an arrow collapses them to one overload.
      const doFetch = ioRef.current.fetch ?? globalThis.fetch.bind(globalThis);
      const storage = ioRef.current.storage ?? browserStorage();

      try {
        let token = storage?.getItem(TOKEN_STORAGE_KEY) ?? undefined;
        if (!token) {
          const minted = await createClient({
            baseUrl,
            fetch: doFetch,
          }).mintToken();
          token = minted.token;
          // Stored before the liveness check on purpose: a token minted and
          // then dropped is an orphaned row on the server.
          storage?.setItem(TOKEN_STORAGE_KEY, token);
        }
        if (!alive) return;
        setConnection({
          state: "connected",
          client: createClient({ baseUrl, token, fetch: doFetch }),
        });
      } catch (error) {
        if (alive) setConnection({ state: "failed", reason: String(error) });
      }
    })();

    return () => {
      alive = false;
    };
  }, [baseUrl]);

  return connection;
}

/** localStorage can throw on access under some privacy settings. */
function browserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
