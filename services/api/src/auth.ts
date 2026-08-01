import type { Context, Next } from "hono";
import type { Repository } from "./repository";
import { hashToken, isValidTokenFormat } from "./tokens";

/**
 * The context shape `requireOwner` populates. Routes that mount the middleware
 * read the owner back with `c.get("ownerId")`, which only typechecks if the
 * Hono instance carries these variables.
 */
export interface AuthVars {
  Variables: { ownerId: string };
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/.exec(header);
  return match?.[1] ?? null;
}

/**
 * Resolves a bearer token to an owner id, or 401s. Applied per-route rather
 * than globally so reads stay public — sharing a link to a tier list is the
 * whole point of the product.
 */
export function requireOwner(repository: Repository) {
  return async (c: Context<AuthVars>, next: Next) => {
    const token = extractBearer(c.req.header("authorization"));

    if (!token || !isValidTokenFormat(token)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const ownerId = await repository.findTokenId(hashToken(token));
    if (!ownerId) return c.json({ error: "unauthorized" }, 401);

    c.set("ownerId", ownerId);
    await next();
  };
}
