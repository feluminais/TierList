import { migrate, type TierList } from "@tl/core";
import type { AssetResponse, ListSummary, TokenResponse, WriteResponse } from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface ClientOptions {
  baseUrl: string;
  token?: string;
  /** Injected so the same client runs in a browser, React Native, and Node. */
  fetch: typeof globalThis.fetch;
}

export interface Client {
  mintToken: () => Promise<TokenResponse>;
  getList: (id: string) => Promise<TierList | null>;
  createList: (doc: TierList) => Promise<WriteResponse>;
  updateList: (
    doc: TierList,
    expectedRevision: number,
  ) => Promise<WriteResponse>;
  listMine: () => Promise<ListSummary[]>;
  /**
   * Uploads raw image bytes. The server decides what the image really is by
   * reading it, so `contentType` here is only a hint and may be corrected in
   * the response.
   */
  uploadAsset: (bytes: Uint8Array, contentType: string) => Promise<AssetResponse>;
  /** Where an asset's bytes are served from. Public — no token involved. */
  assetUrl: (id: string) => string;
}

export function createClient(options: ClientOptions): Client {
  const base = options.baseUrl.replace(/\/+$/, "");

  async function call(
    path: string,
    init: { method: string; body?: unknown; auth: boolean },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (init.auth && options.token) {
      headers.authorization = `Bearer ${options.token}`;
    }

    return options.fetch(`${base}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  }

  async function expectOk(res: Response): Promise<unknown> {
    if (res.ok) return res.json();
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `request failed with ${res.status}`);
  }

  return {
    async mintToken() {
      const res = await call("/tokens", { method: "POST", auth: false });
      return (await expectOk(res)) as TokenResponse;
    },

    async getList(id) {
      const res = await call(`/lists/${id}`, { method: "GET", auth: false });
      if (res.status === 404) return null;
      const body = (await expectOk(res)) as { document: unknown };
      // migrate() decides what a document means, on both sides of the wire.
      return migrate(body.document);
    },

    async createList(doc) {
      const res = await call(`/lists/${doc.id}`, {
        method: "PUT",
        body: { document: doc },
        auth: true,
      });
      return (await expectOk(res)) as WriteResponse;
    },

    async updateList(doc, expectedRevision) {
      const res = await call(`/lists/${doc.id}`, {
        method: "PATCH",
        body: { document: doc, expectedRevision },
        auth: true,
      });
      return (await expectOk(res)) as WriteResponse;
    },

    async listMine() {
      const res = await call("/lists", { method: "GET", auth: true });
      const body = (await expectOk(res)) as { lists: ListSummary[] };
      return body.lists;
    },

    async uploadAsset(bytes, contentType) {
      // Not routed through `call`: that helper sets a JSON content type and
      // stringifies its body, and this endpoint takes neither.
      const headers: Record<string, string> = { "content-type": contentType };
      if (options.token) headers.authorization = `Bearer ${options.token}`;

      const res = await options.fetch(`${base}/assets`, {
        method: "POST",
        headers,
        // Cast needed, and to `any` rather than `BodyInit` specifically:
        // `BodyInit` isn't even an ambient name in this package's own
        // DOM-less tsconfig (its `RequestInit` comes from @types/node's
        // undici shim instead), while a consumer like apps/web sees the
        // overloaded union of the DOM and @types/node declarations and
        // rejects a raw Uint8Array against *that* merged type (see
        // docs/superpowers/STATE.md for the underlying tsconfig gap). No
        // single named type satisfies both compilation contexts. Every
        // real fetch implementation (browser, RN, Node) accepts a
        // Uint8Array body at runtime; only the declared types disagree.
        body: bytes as any,
      });
      return (await expectOk(res)) as AssetResponse;
    },

    assetUrl(id) {
      // Ids are server-generated UUIDs (routes.ts uses randomUUID()), so
      // encoding is a no-op on every real id. It's kept anyway because the
      // failure mode for skipping it is silent, not loud: a stray "#" would
      // truncate the URL into a fragment and a "?" would start a query
      // string, and the string goes straight into Skia.Data.fromURI in the
      // renderer, which has no console to report a malformed request to.
      return `${base}/assets/${encodeURIComponent(id)}`;
    },
  };
}
