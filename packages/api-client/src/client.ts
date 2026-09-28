import { migrate, type TierList } from "@tl/core";
import type {
  AssetResponse,
  AssetSize,
  BrowseParams,
  BrowseResult,
  ListSummary,
  ShareResponse,
  SharedList,
  TokenResponse,
  WriteResponse,
} from "./types";

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

/**
 * The largest request body sent with `keepalive`.
 *
 * Browsers refuse a keepalive request outright once the bodies of all such
 * requests in flight exceed 64 KiB, which would lose the save it was meant to
 * protect. Below this, a save survives the page closing; above it, the save
 * goes as an ordinary request and the device's local draft is the safety net.
 */
export const KEEPALIVE_BODY_LIMIT = 60_000;

export interface WriteOptions {
  /**
   * Let the request outlive the page that sent it — for a save issued while
   * the page is being hidden or closed. Honoured only up to
   * `KEEPALIVE_BODY_LIMIT` bytes; a larger body is sent without it.
   */
  keepalive?: boolean;
}

export interface Client {
  mintToken: () => Promise<TokenResponse>;
  /**
   * The stored list, or null when there is none. A failure to find out — the
   * network, a server error — throws rather than returning null, because
   * "not there" and "could not ask" call for opposite responses.
   */
  getList: (id: string) => Promise<TierList | null>;
  createList: (doc: TierList, options?: WriteOptions) => Promise<WriteResponse>;
  updateList: (
    doc: TierList,
    expectedRevision: number,
    options?: WriteOptions,
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
  /**
   * Creates the list's public link, or returns the one it already has.
   *
   * Idempotent: a list keeps one code for its whole life, so this is safe to
   * call every time the user presses Share. `ogAssetId` names an already
   * uploaded image to use as the link preview.
   */
  shareList: (
    listId: string,
    options?: { ogAssetId?: string; listed?: boolean },
  ) => Promise<ShareResponse>;
  /** Publicly listed shares. No token: browsing is public by definition. */
  browse: (params?: BrowseParams) => Promise<BrowseResult[]>;
  /** Reads a shared list by code. Public — no token involved. */
  getShare: (code: string) => Promise<SharedList | null>;
}

export function createClient(options: ClientOptions): Client {
  const base = options.baseUrl.replace(/\/+$/, "");

  /**
   * Every id that goes into a path goes through here.
   *
   * Ids are generated rather than typed, so this is a no-op on all of them —
   * but the failure mode for skipping it is silent rather than loud: a "#"
   * would truncate the URL into a fragment and a "?" would start a query
   * string, and the result reaches a renderer with no console to report to.
   */
  const segment = (value: string) => encodeURIComponent(value);

  async function call(
    path: string,
    init: { method: string; body?: unknown; auth: boolean; keepalive?: boolean },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (init.auth && options.token) {
      headers.authorization = `Bearer ${options.token}`;
    }

    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    const keepalive =
      init.keepalive === true &&
      body !== undefined &&
      new TextEncoder().encode(body).byteLength <= KEEPALIVE_BODY_LIMIT;

    return options.fetch(`${base}${path}`, {
      method: init.method,
      headers,
      body,
      ...(keepalive ? { keepalive: true } : {}),
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
      const res = await call(`/lists/${segment(id)}`, { method: "GET", auth: false });
      if (res.status === 404) return null;
      const body = (await expectOk(res)) as { document: unknown };
      // migrate() decides what a document means, on both sides of the wire.
      return migrate(body.document);
    },

    async createList(doc, writeOptions) {
      const res = await call(`/lists/${segment(doc.id)}`, {
        method: "PUT",
        body: { document: doc },
        auth: true,
        keepalive: writeOptions?.keepalive,
      });
      return (await expectOk(res)) as WriteResponse;
    },

    async updateList(doc, expectedRevision, writeOptions) {
      const res = await call(`/lists/${segment(doc.id)}`, {
        method: "PATCH",
        body: { document: doc, expectedRevision },
        auth: true,
        keepalive: writeOptions?.keepalive,
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
        // Cast to `any` rather than to a named body type. `BodyInit` is not an
        // ambient name in this package's DOM-less tsconfig, where `fetch`
        // comes from Node's types, while a consumer compiled with the DOM lib
        // sees the overloaded union of both declarations and rejects a raw
        // Uint8Array against that. No single named type satisfies both
        // compilation contexts. Every real fetch implementation accepts a
        // Uint8Array body; only the declarations disagree.
        body: bytes as any,
      });
      return (await expectOk(res)) as AssetResponse;
    },

    async shareList(listId, options) {
      // Only the keys the caller actually set. An explicit `listed: undefined`
      // and an absent key serialise the same, but building the object this way
      // keeps "leave it as it is" expressible and distinct from "set it false".
      const body: Record<string, unknown> = {};
      if (options?.ogAssetId !== undefined) body.ogAssetId = options.ogAssetId;
      if (options?.listed !== undefined) body.listed = options.listed;

      const res = await call(`/lists/${segment(listId)}/share`, {
        method: "POST",
        body,
        auth: true,
      });
      return (await expectOk(res)) as ShareResponse;
    },

    async browse(params) {
      const query = new URLSearchParams();
      if (params?.category) query.set("category", params.category);
      if (params?.q) query.set("q", params.q);
      if (params?.limit !== undefined) query.set("limit", String(params.limit));

      const suffix = query.toString();
      const res = await call(`/browse${suffix ? `?${suffix}` : ""}`, {
        method: "GET",
        auth: false,
      });
      return ((await expectOk(res)) as { results: BrowseResult[] }).results;
    },

    async getShare(code) {
      const res = await call(`/shares/${segment(code)}`, {
        method: "GET",
        auth: false,
      });
      if (res.status === 404) return null;
      const body = (await expectOk(res)) as {
        document: unknown;
        ogAssetId?: string | null;
        listed?: boolean;
        assets?: AssetSize[];
      };
      // migrate() decides what a document means, on both sides of the wire —
      // and a public page renders whatever comes back, so this is the boundary
      // that has to refuse a document it does not understand.
      return {
        document: migrate(body.document),
        ogAssetId: body.ogAssetId ?? null,
        listed: body.listed ?? false,
        assets: body.assets ?? [],
      };
    },

    assetUrl(id) {
      return `${base}/assets/${segment(id)}`;
    },
  };
}
