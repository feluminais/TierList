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
