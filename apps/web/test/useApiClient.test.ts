import { act, createElement, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  useApiClient,
  TOKEN_STORAGE_KEY,
  type ApiClientIo,
  type Connection,
} from "@tl/app-core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface Sent {
  url: string;
  method: string | undefined;
  authorization: string | undefined;
}

/**
 * A reply that is not 200. The fake could only ever produce `ok: true` before,
 * which is precisely why the dead-token path went uncovered: the one status
 * that matters here could not be expressed.
 */
class Status {
  constructor(
    readonly status: number,
    readonly body: unknown = {},
  ) {}
}

function fakeFetch(reply: (url: string) => unknown) {
  const sent: Sent[] = [];
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({ url, method: init?.method, authorization: headers.authorization });
    const body = reply(url);
    if (body instanceof Error) throw body;
    if (body instanceof Status) {
      // The client reads only `ok`, `status` and `json()`.
      return {
        ok: body.status >= 200 && body.status < 300,
        status: body.status,
        json: async () => body.body,
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { doFetch, sent };
}

function memoryStorage(seed?: Record<string, string>) {
  const map = new Map(Object.entries(seed ?? {}));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    map,
  };
}

async function mount(baseUrl: string | undefined, io: ApiClientIo) {
  const probe: { connection: Connection } = {
    connection: { state: "disconnected" },
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function Harness() {
    const [stable] = useState(io);
    const frozen = useMemo(() => stable, [stable]);
    probe.connection = useApiClient(baseUrl, frozen);
    return null;
  }

  await act(async () => {
    root.render(createElement(Harness));
  });
  // Let the token bootstrap settle.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return probe;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("useApiClient", () => {
  it("stays disconnected, and touches nothing, without a base URL", async () => {
    const { doFetch, sent } = fakeFetch(() => ({}));
    const storage = memoryStorage();
    const probe = await mount(undefined, { fetch: doFetch, storage });

    expect(probe.connection.state).toBe("disconnected");
    expect(sent).toHaveLength(0);
    expect(storage.map.size).toBe(0);
  });

  it("mints a device token once and remembers it", async () => {
    const { doFetch, sent } = fakeFetch(() => ({ id: "d1", token: "tok-1" }));
    const storage = memoryStorage();
    const probe = await mount("http://api.test", { fetch: doFetch, storage });

    expect(probe.connection.state).toBe("connected");
    expect(sent[0]?.url).toBe("http://api.test/tokens");
    expect(sent[0]?.method).toBe("POST");
    expect(storage.map.get(TOKEN_STORAGE_KEY)).toBe("tok-1");
  });

  it("puts the token on the wire for authenticated calls", async () => {
    const { doFetch, sent } = fakeFetch((url) =>
      url.endsWith("/tokens") ? { id: "d1", token: "tok-1" } : { lists: [] },
    );
    const probe = await mount("http://api.test", {
      fetch: doFetch,
      storage: memoryStorage(),
    });

    if (probe.connection.state !== "connected") throw new Error("not connected");
    await probe.connection.client.listMine();

    expect(sent[1]?.authorization).toBe("Bearer tok-1");
  });

  it("reuses a stored token the server still accepts, rather than minting another", async () => {
    const { doFetch, sent } = fakeFetch(() => ({ lists: [] }));
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: "kept" });
    const probe = await mount("http://api.test", { fetch: doFetch, storage });

    expect(probe.connection.state).toBe("connected");
    expect(storage.map.get(TOKEN_STORAGE_KEY)).toBe("kept");
    // One request, and it is the liveness probe — not a mint.
    expect(sent.map((s) => s.url)).toEqual(["http://api.test/lists"]);
    expect(sent[0]?.authorization).toBe("Bearer kept");
  });

  /**
   * The defect this covers, found by a user rather than by any test: a stored
   * token can name a device the server has forgotten — the database was reset,
   * or (routinely, in development) the scratch API restarted and its in-memory
   * tokens went with it. Before this, the dead token was used anyway, every
   * authenticated write came back 401, and `useAutosave` retried it forever
   * behind "Save failed — retrying" with no way out: minting only ever
   * happened when there was no stored token at all.
   */
  it("replaces a stored token the server no longer recognises", async () => {
    const { doFetch, sent } = fakeFetch((url) =>
      url.endsWith("/lists")
        ? new Status(401, { error: "unauthorized" })
        : { id: "d2", token: "fresh" },
    );
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: "dead" });
    const probe = await mount("http://api.test", { fetch: doFetch, storage });

    expect(probe.connection.state).toBe("connected");
    expect(storage.map.get(TOKEN_STORAGE_KEY)).toBe("fresh");
    expect(sent.map((s) => s.url)).toEqual([
      "http://api.test/lists",
      "http://api.test/tokens",
    ]);

    // And the client handed back actually carries the new token, rather than
    // the connection merely *reporting* success while still holding the dead
    // one — which is the shape the original bug had.
    if (probe.connection.state !== "connected") throw new Error("not connected");
    await probe.connection.client.listMine().catch(() => {});
    expect(sent[sent.length - 1]?.authorization).toBe("Bearer fresh");
  });

  /**
   * The asymmetry that makes the check safe. A 401 is the server saying "I do
   * not know this token"; anything else is a fault. Minting on a fault would
   * orphan every list the old token owns — permanently, ownership-scoped —
   * in response to a transient outage.
   */
  it("does not discard a good token because the server is broken", async () => {
    const { doFetch, sent } = fakeFetch(() => new Status(500, { error: "boom" }));
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: "kept" });
    const probe = await mount("http://api.test", { fetch: doFetch, storage });

    expect(probe.connection.state).toBe("failed");
    expect(storage.map.get(TOKEN_STORAGE_KEY)).toBe("kept");
    // No mint was attempted.
    expect(sent.some((s) => s.url.endsWith("/tokens"))).toBe(false);
  });

  it("does not probe when there is no stored token to probe", async () => {
    const { doFetch, sent } = fakeFetch(() => ({ id: "d1", token: "tok-1" }));
    const storage = memoryStorage();
    await mount("http://api.test", { fetch: doFetch, storage });

    expect(sent.map((s) => s.url)).toEqual(["http://api.test/tokens"]);
  });

  it("reports a failure rather than a silent half-connected state", async () => {
    const { doFetch } = fakeFetch(() => new Error("network down"));
    const probe = await mount("http://api.test", {
      fetch: doFetch,
      storage: memoryStorage(),
    });

    expect(probe.connection.state).toBe("failed");
  });
});
