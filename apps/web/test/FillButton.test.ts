import { createTierList, migrate, reduce, type TierList } from "@tl/core";
import { act, createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FillButton } from "../app/l/[code]/FillButton";
import { TOKEN_STORAGE_KEY } from "@tl/app-core";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = "2026-08-01T12:00:00.000Z";
const BASE = "http://api.test";

const pushed: string[] = [];
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (href: string) => pushed.push(href),
    replace: (href: string) => pushed.push(href),
  }),
}));

/** A template as a reader receives it: rows and items, everything in the tray. */
function template(): TierList {
  let doc = createTierList({ id: "tpl-1", now: NOW, title: "Ramen" });
  doc = reduce(doc, { type: "item/addText", id: "i1", label: "Tonkotsu" }, NOW);
  doc = reduce(doc, { type: "item/addText", id: "i2", label: "Shoyu" }, NOW);
  return { ...doc, revision: 7 };
}

interface Sent {
  url: string;
  method: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

function fakeFetch(reply: (url: string) => unknown) {
  const sent: Sent[] = [];
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({
      url,
      method: init?.method,
      authorization: headers.authorization,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : init?.body,
    });
    const body = reply(url);
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as typeof globalThis.fetch;
  return { doFetch, sent };
}

beforeEach(() => {
  pushed.length = 0;
  window.localStorage.clear();
});
afterEach(cleanup);

async function press() {
  await act(async () => {
    fireEvent.click(screen.getByTestId("fill-this-in"));
  });
  // Let the awaited chain settle.
  await act(async () => {
    await Promise.resolve();
  });
}

function mount(doFetch: typeof globalThis.fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = doFetch;
  render(createElement(FillButton, { source: template(), baseUrl: BASE }));
  return () => {
    globalThis.fetch = original;
  };
}

describe("FillButton", () => {
  it("mints a token, creates a fill, and opens the editor on it", async () => {
    const { doFetch, sent } = fakeFetch((url) =>
      url.endsWith("/tokens") ? { id: "d1", token: "tok-1" } : { id: "x", revision: 0 },
    );
    const restore = mount(doFetch);
    await press();
    restore();

    expect(sent[0]?.url).toBe(`${BASE}/tokens`);
    // The write is authenticated with the token just minted, and remembered so
    // the reader owns what they made.
    const write = sent[1]!;
    expect(write.method).toBe("PUT");
    expect(write.authorization).toBe("Bearer tok-1");
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBe("tok-1");

    expect(pushed).toHaveLength(1);
    expect(pushed[0]).toMatch(/^\/editor\/.+/);
  });

  it("reuses a token this browser already holds", async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, "existing");
    const { doFetch, sent } = fakeFetch(() => ({ id: "x", revision: 0 }));
    const restore = mount(doFetch);
    await press();
    restore();

    expect(sent.some((s) => s.url.endsWith("/tokens"))).toBe(false);
    expect(sent[0]?.authorization).toBe("Bearer existing");
  });

  /**
   * The stamp comparison depends on, and the reason `startFill` exists. Neither
   * field can be reconstructed later — the template and the fill both keep
   * changing — so if this write is wrong the information is gone for good.
   */
  it("stamps the source's id and revision onto the fill", async () => {
    const { doFetch, sent } = fakeFetch((url) =>
      url.endsWith("/tokens") ? { id: "d1", token: "t" } : { id: "x", revision: 0 },
    );
    const restore = mount(doFetch);
    await press();
    restore();

    const doc = (sent[1]!.body as { document: TierList }).document;
    expect(doc.templateId).toBe("tpl-1");
    expect(doc.templateRevision).toBe(7);
  });

  it("gives the fill a fresh id, not the template's", async () => {
    const { doFetch, sent } = fakeFetch((url) =>
      url.endsWith("/tokens") ? { id: "d1", token: "t" } : { id: "x", revision: 0 },
    );
    const restore = mount(doFetch);
    await press();
    restore();

    const doc = (sent[1]!.body as { document: TierList }).document;
    expect(doc.id).not.toBe("tpl-1");
    // And the editor is opened on that same id, not on the template's.
    expect(pushed[0]).toBe(`/editor/${encodeURIComponent(doc.id)}`);
  });

  it("starts the fill with every item in the tray", async () => {
    const { doFetch, sent } = fakeFetch((url) =>
      url.endsWith("/tokens") ? { id: "d1", token: "t" } : { id: "x", revision: 0 },
    );
    const restore = mount(doFetch);
    await press();
    restore();

    const doc = (sent[1]!.body as { document: TierList }).document;
    expect(doc.items).toHaveLength(2);
    expect(doc.placements).toHaveLength(2);
    expect(doc.placements.every((p) => p.rowId === null)).toBe(true);
  });

  it("sends a document the receiving side accepts", async () => {
    const { doFetch, sent } = fakeFetch((url) =>
      url.endsWith("/tokens") ? { id: "d1", token: "t" } : { id: "x", revision: 0 },
    );
    const restore = mount(doFetch);
    await press();
    restore();

    // `migrate` is what the API validates with, so round-tripping through it
    // is the same check the server will make.
    const raw = (sent[1]!.body as { document: unknown }).document;
    expect(() => migrate(JSON.parse(JSON.stringify(raw)))).not.toThrow();
  });

  it("reports a failure and stays usable rather than navigating", async () => {
    const { doFetch } = fakeFetch(() => new Error("network down"));
    const restore = mount(doFetch);
    await press();
    restore();

    expect(screen.getByTestId("fill-error")).not.toBeNull();
    expect(pushed).toHaveLength(0);
    expect(screen.getByTestId<HTMLButtonElement>("fill-this-in").disabled).toBe(false);
  });
});
