import { migrate, type TierList } from "@tl/core";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { requireOwner, type AuthVars } from "./auth";
import { RevisionConflictError, type Repository } from "./repository";
import { generateToken, hashToken } from "./tokens";

export interface RouteDeps {
  repository: Repository;
}

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

  return routes;
}
