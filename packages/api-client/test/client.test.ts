import { createTierList } from "@tl/core";
import { describe, expect, it, vi } from "vitest";
import { ApiError, createClient } from "../src/client";

const NOW = "2026-08-01T12:00:00.000Z";
const BASE = "https://api.example.test";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("createClient", () => {
  it("mints a token without sending authorization", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: "t1", token: "abc" }, 201));
    const client = createClient({ baseUrl: BASE, fetch: fetchFn });

    const result = await client.mintToken();

    expect(result).toEqual({ id: "t1", token: "abc" });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/tokens`);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBeUndefined();
  });

  it("sends the bearer token on authenticated calls", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ lists: [] }));
    const client = createClient({
      baseUrl: BASE,
      token: "secret",
      fetch: fetchFn,
    });

    await client.listMine();

    const [, init] = fetchFn.mock.calls[0]!;
    expect(init.headers.authorization).toBe("Bearer secret");
  });

  it("round-trips a document through createList", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: "list-1", revision: 0 }, 201));
    const client = createClient({
      baseUrl: BASE,
      token: "secret",
      fetch: fetchFn,
    });

    const result = await client.createList(doc);

    expect(result).toEqual({ id: "list-1", revision: 0 });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe(`${BASE}/lists/list-1`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body)).toEqual({ document: doc });
  });

  it("returns null rather than throwing when a list is missing", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "not found" }, 404));
    const client = createClient({ baseUrl: BASE, fetch: fetchFn });

    await expect(client.getList("nope")).resolves.toBeNull();
  });

  it("throws ApiError carrying the status on a conflict", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "revision conflict" }, 409));
    const client = createClient({
      baseUrl: BASE,
      token: "secret",
      fetch: fetchFn,
    });

    await expect(client.updateList(doc, 0)).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
    });
  });

  it("throws ApiError on an unauthorized write", async () => {
    const doc = createTierList({ id: "list-1", now: NOW });
    const fetchFn = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: "unauthorized" }, 401));
    const client = createClient({ baseUrl: BASE, fetch: fetchFn });

    await expect(client.createList(doc)).rejects.toBeInstanceOf(ApiError);
  });

  it("passes stored documents through @tl/core migrate on read", async () => {
    const doc = createTierList({ id: "list-1", now: NOW, title: "Ramen" });
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ document: doc }));
    const client = createClient({ baseUrl: BASE, fetch: fetchFn });

    await expect(client.getList("list-1")).resolves.toEqual(doc);
  });

  it("trims a trailing slash from baseUrl", async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ lists: [] }));
    const client = createClient({
      baseUrl: `${BASE}/`,
      token: "t",
      fetch: fetchFn,
    });

    await client.listMine();
    expect(fetchFn.mock.calls[0]![0]).toBe(`${BASE}/lists`);
  });
});

describe("assets", () => {
  it("posts raw bytes with the declared type and no JSON wrapper", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createClient({
      baseUrl: "https://api.test",
      token: "t".repeat(43),
      fetch: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(
          JSON.stringify({
            id: "a1", contentType: "image/png", width: 10, height: 5, byteSize: 24,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof globalThis.fetch,
    });

    const bytes = new Uint8Array([1, 2, 3]);
    const result = await client.uploadAsset(bytes, "image/png");

    expect(result).toEqual({
      id: "a1", contentType: "image/png", width: 10, height: 5, byteSize: 24,
    });
    expect(calls[0]!.url).toBe("https://api.test/assets");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBe(bytes);
    expect((calls[0]!.init.headers as Record<string, string>)["content-type"]).toBe("image/png");
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(
      `Bearer ${"t".repeat(43)}`,
    );
  });

  it("omits authorization when no token is configured", async () => {
    const calls: { init: RequestInit }[] = [];
    const client = createClient({
      baseUrl: "https://api.test",
      fetch: (async (_url: string, init: RequestInit) => {
        calls.push({ init });
        return new Response(
          JSON.stringify({
            id: "a1", contentType: "image/png", width: 10, height: 5, byteSize: 24,
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }) as unknown as typeof globalThis.fetch,
    });

    await client.uploadAsset(new Uint8Array([1]), "image/png");

    expect(
      (calls[0]!.init.headers as Record<string, string>).authorization,
    ).toBeUndefined();
  });

  it("raises an ApiError carrying the status for a rejected upload", async () => {
    const client = createClient({
      baseUrl: "https://api.test",
      token: "t".repeat(43),
      fetch: (async () =>
        new Response(JSON.stringify({ error: "unsupported image" }), {
          status: 415,
          headers: { "content-type": "application/json" },
        })) as unknown as typeof globalThis.fetch,
    });

    await expect(client.uploadAsset(new Uint8Array([1]), "image/png")).rejects.toMatchObject({
      status: 415,
      message: "unsupported image",
    });
  });

  it("builds an asset URL against the same base, with the trailing slash stripped", () => {
    const client = createClient({ baseUrl: "https://api.test/", fetch: globalThis.fetch });
    expect(client.assetUrl("a1")).toBe("https://api.test/assets/a1");
  });

  it("encodes an id so a stray '#' or '?' can't hijack the URL", () => {
    // Ids are server-generated UUIDs in practice, but assetUrl is fed
    // straight into Skia.Data.fromURI by the renderer, where a malformed
    // URL fails silently. "#" would truncate into a fragment and "?" would
    // start a query string, so both must survive as literal path segments.
    const client = createClient({ baseUrl: "https://api.test", fetch: globalThis.fetch });
    expect(client.assetUrl("a#b")).toBe("https://api.test/assets/a%23b");
    expect(client.assetUrl("a?b")).toBe("https://api.test/assets/a%3Fb");
  });
});
