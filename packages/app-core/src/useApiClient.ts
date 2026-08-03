"use client";

import { ApiError, createClient, type Client } from "@tl/api-client";
import { useEffect, useRef, useState } from "react";

/**
 * Where the anonymous device token is kept between visits.
 *
 * Minting a fresh one on every load would orphan every list the previous token
 * owned, because writes are ownership-scoped.
 */
export const TOKEN_STORAGE_KEY = "tl.deviceToken";

/**
 * What the editor knows about the server.
 *
 * `disconnected` is not an error. No API runs by default, so the honest answer
 * for an unset `NEXT_PUBLIC_API_URL` is that nothing is being saved — neither
 * a failure nor a success.
 */
export type Connection =
  | { state: "disconnected" }
  | { state: "connecting" }
  | { state: "connected"; client: Client }
  | { state: "failed"; reason: string };

/**
 * Where the device token is kept, in the smallest shape both platforms can
 * satisfy.
 *
 * Reads may be async because React Native's storage is: `AsyncStorage.getItem`
 * returns a promise, and `localStorage.getItem` returns a string. Both are
 * awaited, so one hook serves both without either pretending to be the other.
 */
export interface TokenStore {
  getItem: (key: string) => string | null | Promise<string | null>;
  setItem: (key: string, value: string) => void | Promise<void>;
}

export interface ApiClientIo {
  fetch?: typeof globalThis.fetch;
  storage?: TokenStore | null;
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
        let token = (await storage?.getItem(TOKEN_STORAGE_KEY)) ?? undefined;

        // A stored token can name a device the server has forgotten: the
        // database was reset, the row was pruned, or the scratch API restarted
        // and its in-memory tokens went with it. Unchecked, every
        // authenticated write then answers 401, which `useAutosave` treats as
        // transient and retries forever — an unrecoverable "Save failed"
        // readout, because the only thing that would clear it is minting a new
        // token.
        //
        // Costs one round trip per load, and buys a `connected` state that has
        // actually been established.
        if (token) {
          const live = await tokenIsLive(createClient({ baseUrl, token, fetch: doFetch }));
          if (!live) token = undefined;
        }

        if (!token) {
          const minted = await createClient({
            baseUrl,
            fetch: doFetch,
          }).mintToken();
          token = minted.token;
          // Stored before the liveness check on purpose: a token minted and
          // then dropped is an orphaned row on the server. Overwrites a
          // rejected one, which is all the cleanup a dead token needs.
          await storage?.setItem(TOKEN_STORAGE_KEY, token);
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

/**
 * Whether the server still recognises this token.
 *
 * `listMine` is the probe because it is the cheapest authenticated read the
 * client has — it touches one indexed column and returns the caller's own
 * lists, so it cannot fail for a reason that is really about some other
 * resource.
 *
 * **Only a 401 means "not live".** Anything else is rethrown, so a server that
 * is down or broken surfaces as `failed` rather than being quietly answered
 * with a freshly minted token — which would orphan every list the old token
 * owned, permanently, in response to a transient outage. That asymmetry is the
 * whole reason this is a named function rather than a `catch` returning false.
 */
async function tokenIsLive(client: Client): Promise<boolean> {
  try {
    await client.listMine();
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return false;
    throw error;
  }
}

/**
 * `localStorage` when there is one.
 *
 * Reached through `globalThis` rather than named directly so this compiles in
 * a package with no DOM lib, and guarded because access itself throws under
 * some privacy settings. React Native has no `localStorage`, so a caller there
 * passes its own store and never reaches this.
 */
function browserStorage(): TokenStore | null {
  try {
    return (globalThis as { localStorage?: TokenStore }).localStorage ?? null;
  } catch {
    return null;
  }
}
