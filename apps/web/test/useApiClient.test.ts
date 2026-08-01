import { act, createElement, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vitest";
import {
  useApiClient,
  TOKEN_STORAGE_KEY,
  type ApiClientIo,
  type Connection,
} from "../app/editor/useApiClient";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

interface Sent {
  url: string;
  method: string | undefined;
  authorization: string | undefined;
}

function fakeFetch(reply: (url: string) => unknown) {
  const sent: Sent[] = [];
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({ url, method: init?.method, authorization: headers.authorization });
    const body = reply(url);
    if (body instanceof Error) throw body;
    // The client reads only `ok`, `status` and `json()`.
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

  it("reuses a stored token rather than minting another", async () => {
    const { doFetch, sent } = fakeFetch(() => ({ lists: [] }));
    const storage = memoryStorage({ [TOKEN_STORAGE_KEY]: "kept" });
    const probe = await mount("http://api.test", { fetch: doFetch, storage });

    expect(probe.connection.state).toBe("connected");
    // Minting would have been the only request made during the bootstrap.
    expect(sent).toHaveLength(0);
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
