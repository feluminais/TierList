import { migrate, type TierList } from "@tl/core";
import { Hono } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { requireOwner, type AuthVars } from "./auth";
import { sniffImage } from "./image";
import { RevisionConflictError, type Repository } from "./repository";
import type { ObjectStore } from "./store";
import { generateToken, hashToken } from "./tokens";

export interface RouteDeps {
  repository: Repository;
  store: ObjectStore;
}

/**
 * A ceiling on a single upload. Generous for a source image and small enough
 * that a request cannot be used to exhaust memory — the body is buffered whole,
 * because `sniffImage` and the checksum both need the complete bytes.
 */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Parses an untrusted body into a TierList using @tl/core's own migrate(),
 * which is the only code allowed to decide what a valid document is.
 * Returns null rather than throwing so callers map it to a 400.
 */
function parseDocument(value: unknown): TierList | null {
  try {
    return migrate(value);
  } catch {
    return null;
  }
}

export function createRoutes(deps: RouteDeps) {
  const routes = new Hono<AuthVars>();

  /**
   * The one place the server generates an id and reads the clock. The document
   * model forbids both so reductions stay deterministic, but a token has no
   * such requirement and no caller should be choosing its own identity.
   */
  routes.post("/tokens", async (c) => {
    const token = generateToken();
    const id = randomUUID();
    await deps.repository.createToken(id, hashToken(token), new Date());
    return c.json({ id, token }, 201);
  });

  /** Scoped to the caller. Registered before `/lists/:id` for readability; the
   * two patterns do not overlap, so order does not affect matching. */
  routes.get("/lists", requireOwner(deps.repository), async (c) => {
    const lists = await deps.repository.listByOwner(c.get("ownerId"));
    return c.json({ lists });
  });

  routes.put("/lists/:id", requireOwner(deps.repository), async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const doc = parseDocument((body as { document?: unknown })?.document);

    if (!doc) return c.json({ error: "invalid document" }, 400);
    if (doc.id !== id) return c.json({ error: "id mismatch" }, 400);

    const created = await deps.repository.create(doc, c.get("ownerId"));
    if (!created) return c.json({ error: "already exists" }, 409);
    return c.json({ id: doc.id, revision: doc.revision }, 201);
  });

  // Deliberately unauthenticated: sharing a link to a tier list is the point.
  routes.get("/lists/:id", async (c) => {
    const doc = await deps.repository.load(c.req.param("id"));
    if (!doc) return c.json({ error: "not found" }, 404);
    return c.json({ document: doc });
  });

  routes.patch("/lists/:id", requireOwner(deps.repository), async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as {
      document?: unknown;
      expectedRevision?: unknown;
    } | null;

    const doc = parseDocument(body?.document);
    const expected = body?.expectedRevision;

    if (!doc) return c.json({ error: "invalid document" }, 400);
    if (doc.id !== id) return c.json({ error: "id mismatch" }, 400);
    if (typeof expected !== "number") {
      return c.json({ error: "expectedRevision is required" }, 400);
    }

    const ownerId = c.get("ownerId");
    const currentOwner = await deps.repository.findOwner(id);

    // Unknown id and someone else's id are deliberately the same response:
    // telling a stranger that an id exists is a small information leak, and
    // no legitimate client needs the distinction.
    //
    // Checking here rather than relying on update() failing is what keeps 404
    // and 409 apart. There is a benign race — ownership could change between
    // this check and the update, and the update would then 409 at someone who
    // no longer owns the document. Nothing transfers ownership today, so it
    // cannot happen; if transfer is ever added the cost is a spurious retry,
    // not unauthorised access.
    if (currentOwner === null || currentOwner !== ownerId) {
      return c.json({ error: "not found" }, 404);
    }

    try {
      await deps.repository.update(doc, expected, ownerId);
    } catch (e) {
      if (e instanceof RevisionConflictError) {
        // Ownership is already established, so this can only be a stale
        // revision. 409 tells the client to re-read and retry.
        return c.json({ error: "revision conflict" }, 409);
      }
      throw e;
    }

    return c.json({ id: doc.id, revision: doc.revision });
  });

  routes.post("/assets", requireOwner(deps.repository), async (c) => {
    const body = new Uint8Array(await c.req.arrayBuffer());

    // Checked after buffering rather than from the Content-Length header,
    // because a header is a claim and a chunked request need not send one.
    if (body.byteLength > MAX_UPLOAD_BYTES) {
      return c.json({ error: "too large" }, 413);
    }

    // The sole authority on what an upload is. The request's own content-type
    // is deliberately never read: it is a claim by the uploader, and trusting
    // it would let a caller store anything under an image's name.
    const info = sniffImage(body);
    if (!info) return c.json({ error: "unsupported image" }, 415);

    const ownerId = c.get("ownerId");
    const checksum = createHash("sha256").update(body).digest("hex");

    // Adding the same picture to a list twice is ordinary. Returning the asset
    // the owner already has costs one lookup and saves a second copy.
    const existing = await deps.repository.findAssetByChecksum(ownerId, checksum);
    if (existing) {
      return c.json(
        {
          id: existing.id,
          contentType: existing.contentType,
          width: existing.width,
          height: existing.height,
          byteSize: existing.byteSize,
        },
        200,
      );
    }

    const id = randomUUID();
    const storageKey = `assets/${id}`;

    // Bytes first: an asset row pointing at a key with nothing behind it would
    // render as a permanently broken tile, whereas an orphaned object is
    // invisible and costs only space.
    await deps.store.put(storageKey, body, info.contentType);
    await deps.repository.createAsset({
      id,
      ownerId,
      storageKey,
      contentType: info.contentType,
      byteSize: body.byteLength,
      width: info.width,
      height: info.height,
      checksum,
      createdAt: new Date(),
    });

    return c.json(
      {
        id,
        contentType: info.contentType,
        width: info.width,
        height: info.height,
        byteSize: body.byteLength,
      },
      201,
    );
  });

  return routes;
}
