import { migrate, type TierList } from "@tl/core";
import type { ListSummary, TokenResponse, WriteResponse } from "./types";

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
  };
}
