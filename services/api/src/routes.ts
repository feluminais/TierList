import { migrate, type TierList } from "@tl/core";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
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
  const routes = new Hono();

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

  routes.put("/lists/:id", async (c) => {
    const id = c.req.param("id");
    const body = await c.req.json().catch(() => null);
    const doc = parseDocument((body as { document?: unknown })?.document);

    if (!doc) return c.json({ error: "invalid document" }, 400);
    if (doc.id !== id) return c.json({ error: "id mismatch" }, 400);

    const created = await deps.repository.create(doc);
    if (!created) return c.json({ error: "already exists" }, 409);
    return c.json({ id: doc.id, revision: doc.revision }, 201);
  });

  routes.get("/lists/:id", async (c) => {
    const doc = await deps.repository.load(c.req.param("id"));
    if (!doc) return c.json({ error: "not found" }, 404);
    return c.json({ document: doc });
  });

  routes.patch("/lists/:id", async (c) => {
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

    try {
      await deps.repository.update(doc, expected);
    } catch (e) {
      if (e instanceof RevisionConflictError) {
        return c.json({ error: "revision conflict" }, 409);
      }
      throw e;
    }

    return c.json({ id: doc.id, revision: doc.revision });
  });

  return routes;
}
