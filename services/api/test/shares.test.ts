import { createTierList, reduce, type TierList } from "@tl/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { createRepository } from "../src/repository";
import { generateShareCode, isPlausibleShareCode } from "../src/sharecode";
import { createMemoryStore } from "../src/store";
import { pngBytes } from "./helpers/images";
import { createTestDb, type TestDb } from "./helpers/pglite";

const NOW = "2026-08-01T12:00:00.000Z";

let ctx: TestDb;
let app: ReturnType<typeof buildApp>;

beforeEach(async () => {
  ctx = await createTestDb();
  app = buildApp({ repository: createRepository(ctx.db), store: createMemoryStore() });
});

afterEach(async () => {
  await ctx.close();
});

async function mint(): Promise<string> {
  const res = await app.request("/tokens", { method: "POST" });
  return ((await res.json()) as { token: string }).token;
}

function auth(token: string) {
  return { "content-type": "application/json", authorization: `Bearer ${token}` };
}

/** A list with something in it, so a shared read has something to prove. */
function sampleDoc(id: string): TierList {
  let doc = createTierList({ id, now: NOW });
  doc = reduce(doc, { type: "item/addText", id: "i0", label: "Ramen" }, NOW);
  doc = reduce(
    doc,
    { type: "placement/place", itemId: "i0", rowId: doc.rows[0]!.id, index: 0 },
    NOW,
  );
  return doc;
}

async function createList(token: string, id = "list-1"): Promise<TierList> {
  const doc = sampleDoc(id);
  const res = await app.request(`/lists/${id}`, {
    method: "PUT",
    headers: auth(token),
    body: JSON.stringify({ document: doc }),
  });
  expect(res.status).toBe(201);
  return doc;
}

async function share(token: string, id = "list-1", body: object = {}) {
  return app.request(`/lists/${id}/share`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify(body),
  });
}

describe("share codes", () => {
  it("generates eight characters from the reduced alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateShareCode();
      expect(code).toHaveLength(8);
      expect(isPlausibleShareCode(code)).toBe(true);
    }
  });

  /**
   * The point of Crockford's alphabet: a code is read aloud, typed from a
   * screenshot and pasted out of a chat window, and `1/I/l` and `0/O` are the
   * pairs that go wrong when it is.
   */
  it("never emits the ambiguous letters", () => {
    for (let i = 0; i < 500; i++) {
      expect(generateShareCode()).not.toMatch(/[ILOU]/);
    }
  });

  it("does not repeat itself", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generateShareCode());
    expect(seen.size).toBe(500);
  });

  it("rejects strings that could not have been issued", () => {
    expect(isPlausibleShareCode("")).toBe(false);
    expect(isPlausibleShareCode("ABCDEFG")).toBe(false); // seven
    expect(isPlausibleShareCode("ABCDEFGHI")).toBe(false); // nine
    expect(isPlausibleShareCode("abcdefgh")).toBe(false); // lower case
    expect(isPlausibleShareCode("ABCDEFGI")).toBe(false); // excluded letter
    expect(isPlausibleShareCode("ABCDEF-H")).toBe(false);
  });
});

describe("POST /lists/:id/share", () => {
  it("mints a code for the owner", async () => {
    const token = await mint();
    await createList(token);

    const res = await share(token);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; ogAssetId: string | null };
    expect(isPlausibleShareCode(body.code)).toBe(true);
    expect(body.ogAssetId).toBeNull();
  });

  /**
   * A link that has been pasted into a chat has to keep working, and two live
   * codes for one list would mean the OG image cached against one of them is
   * silently not the one a reader gets.
   */
  it("returns the same code on a second call rather than minting another", async () => {
    const token = await mint();
    await createList(token);

    const first = (await (await share(token)).json()) as { code: string };
    const second = await share(token);
    expect(second.status).toBe(200);
    expect(((await second.json()) as { code: string }).code).toBe(first.code);
  });

  it("refuses a list the caller does not own, and says only 'not found'", async () => {
    const owner = await mint();
    const stranger = await mint();
    await createList(owner);

    const res = await share(stranger);
    expect(res.status).toBe(404);
  });

  it("refuses a list that does not exist, with the same answer", async () => {
    const token = await mint();
    const res = await share(token, "no-such-list");
    expect(res.status).toBe(404);
  });

  it("refuses an unauthenticated caller", async () => {
    const token = await mint();
    await createList(token);
    const res = await app.request("/lists/list-1/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("records an OG asset and lets a later call replace it", async () => {
    const token = await mint();
    await createList(token);

    const upload = async () => {
      const res = await app.request("/assets", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        // Two different sizes, so the checksums differ and the second upload
        // is a genuinely new asset rather than a dedupe hit.
        body: pngBytes(11, 7),
      });
      return ((await res.json()) as { id: string }).id;
    };

    const firstAsset = await upload();
    const created = await share(token, "list-1", { ogAssetId: firstAsset });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { ogAssetId: string }).ogAssetId).toBe(firstAsset);

    const secondRes = await app.request("/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: pngBytes(13, 9),
    });
    const secondAsset = ((await secondRes.json()) as { id: string }).id;

    const updated = await share(token, "list-1", { ogAssetId: secondAsset });
    expect(updated.status).toBe(200);
    expect(((await updated.json()) as { ogAssetId: string }).ogAssetId).toBe(secondAsset);
  });

  /**
   * A share created before its preview was rendered is a working link. A later
   * call must not blank the picture it already has just because this one had
   * none to offer.
   */
  it("keeps an existing OG asset when a later call sends none", async () => {
    const token = await mint();
    await createList(token);

    const assetRes = await app.request("/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: pngBytes(11, 7),
    });
    const assetId = ((await assetRes.json()) as { id: string }).id;

    await share(token, "list-1", { ogAssetId: assetId });
    const again = await share(token, "list-1", {});
    expect(((await again.json()) as { ogAssetId: string | null }).ogAssetId).toBe(assetId);
  });

  it("ignores an ogAssetId that could not name an asset", async () => {
    const token = await mint();
    await createList(token);
    const res = await share(token, "list-1", { ogAssetId: "with\0a null byte" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { ogAssetId: string | null }).ogAssetId).toBeNull();
  });

  // An accepted id becomes the link preview's image URL, so one that names
  // nothing would publish a card pointing at a 404.
  it("refuses an ogAssetId that names no asset", async () => {
    const token = await mint();
    await createList(token);
    const res = await share(token, "list-1", { ogAssetId: "00000000-0000-4000-8000-000000000000" });
    expect(res.status).toBe(400);
  });

  it("creates no share at all when the ogAssetId is refused", async () => {
    const token = await mint();
    await createList(token);
    await share(token, "list-1", { ogAssetId: "00000000-0000-4000-8000-000000000000" });

    const retried = await share(token, "list-1");
    expect(retried.status).toBe(201);
  });

  it("refuses an unknown ogAssetId on a list that already has a code", async () => {
    const token = await mint();
    await createList(token);
    const first = await share(token, "list-1");
    const { code } = (await first.json()) as { code: string };

    const res = await share(token, "list-1", {
      ogAssetId: "00000000-0000-4000-8000-000000000000",
    });
    expect(res.status).toBe(400);

    // The existing code keeps whatever preview it had.
    const read = await app.request(`/shares/${code}`);
    expect(((await read.json()) as { ogAssetId: string | null }).ogAssetId).toBeNull();
  });

  it("answers not-found before it looks at the ogAssetId", async () => {
    const owner = await mint();
    const stranger = await mint();
    await createList(owner);

    const res = await share(stranger, "list-1", { ogAssetId: "anything" });
    expect(res.status).toBe(404);
  });
});

describe("GET /shares/:code", () => {
  it("returns the document to anyone holding the code", async () => {
    const token = await mint();
    await createList(token);
    const { code } = (await (await share(token)).json()) as { code: string };

    // No authorization header at all: holding the code *is* the authorisation.
    const res = await app.request(`/shares/${code}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { document: TierList; ogAssetId: string | null };
    expect(body.document.items.map((i) => i.label)).toEqual(["Ramen"]);
    expect(body.ogAssetId).toBeNull();
  });

  /**
   * A reader must never learn the list id: with it they could hit the owned
   * endpoints, and `PUT` already leaks id existence through its 409.
   */
  /**
   * A crop is a fraction of its source, so a renderer that never decodes the
   * image cannot tell which part of it a tile shows. Sending the sizes with
   * the document is what lets the public page lay out an image tile in one
   * round trip instead of one per tile — or wrongly.
   */
  it("sends the intrinsic size of every image the document references", async () => {
    const token = await mint();
    const doc = await createList(token);

    const assetRes = await app.request("/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: pngBytes(1920, 1080),
    });
    const assetId = ((await assetRes.json()) as { id: string }).id;

    const withImage = reduce(
      doc,
      { type: "item/addImage", id: "img-1", assetId },
      NOW,
    );
    await app.request("/lists/list-1", {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ document: withImage, expectedRevision: doc.revision }),
    });

    const { code } = (await (await share(token)).json()) as { code: string };
    const body = (await (await app.request(`/shares/${code}`)).json()) as {
      assets: { id: string; width: number; height: number }[];
    };
    expect(body.assets).toEqual([{ id: assetId, width: 1920, height: 1080 }]);
  });

  it("sends an empty asset list for a document with no images", async () => {
    const token = await mint();
    await createList(token);
    const { code } = (await (await share(token)).json()) as { code: string };
    const body = (await (await app.request(`/shares/${code}`)).json()) as { assets: unknown[] };
    expect(body.assets).toEqual([]);
  });

  it("does not disclose the list id outside the document itself", async () => {
    const token = await mint();
    await createList(token, "secret-list-id");
    const { code } = (await (await share(token, "secret-list-id")).json()) as { code: string };

    const res = await app.request(`/shares/${code}`);
    const body = (await res.json()) as { document: TierList } & Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["assets", "document", "ogAssetId"]);
    // The document carries its own id, which is unavoidable — it is the
    // document. What matters is that no *extra* field hands it over.
    expect(body.document.id).toBe("secret-list-id");
  });

  it("serves the latest revision, not the one that was shared", async () => {
    const token = await mint();
    const doc = await createList(token);
    const { code } = (await (await share(token)).json()) as { code: string };

    const renamed = reduce(doc, { type: "meta/set", patch: { title: "Noodles" } }, NOW);
    const patch = await app.request("/lists/list-1", {
      method: "PATCH",
      headers: auth(token),
      body: JSON.stringify({ document: renamed, expectedRevision: doc.revision }),
    });
    expect(patch.status).toBe(200);

    const res = await app.request(`/shares/${code}`);
    expect(((await res.json()) as { document: TierList }).document.title).toBe("Noodles");
  });

  it("404s an unknown code", async () => {
    const res = await app.request("/shares/ABCDEFGH");
    expect(res.status).toBe(404);
  });

  it("404s a code that could never have been issued, without a lookup", async () => {
    for (const bad of ["abc", "abcdefgh", "ABCDEFGI", "%2E%2E%2F"]) {
      expect((await app.request(`/shares/${bad}`)).status).toBe(404);
    }
  });

  it("reports the OG asset so a page can point its preview at it", async () => {
    const token = await mint();
    await createList(token);
    const assetRes = await app.request("/assets", {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: pngBytes(11, 7),
    });
    const assetId = ((await assetRes.json()) as { id: string }).id;
    const { code } = (await (await share(token, "list-1", { ogAssetId: assetId })).json()) as {
      code: string;
    };

    const res = await app.request(`/shares/${code}`);
    expect(((await res.json()) as { ogAssetId: string }).ogAssetId).toBe(assetId);

    // And that asset is publicly readable, or every preview is a broken image.
    const asset = await app.request(`/assets/${assetId}`);
    expect(asset.status).toBe(200);
  });
});
