/**
 * Fresh ids for the things this app creates.
 *
 * `crypto.randomUUID` is the right source — a module-scope counter would
 * collide between two tabs editing the same list — but it exists only in
 * *secure contexts*, so it is absent over plain http to a LAN address, which is
 * exactly how a phone reaches a dev server. The fallback is not
 * cryptographically anything; it only has to not collide.
 *
 * A list id reaches a URL and a share link, so it is generated in one place
 * rather than per caller: the editor, the redirect that opens `/editor` with no
 * id, and the button that starts a fill all mint one, and an id that differed
 * in shape between them would be a difference nothing would notice until a link
 * did not resolve.
 */
function randomId(prefix: string): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** A new document: a list, a template, or a fill. */
export function newListId(): string {
  return randomId("list");
}

/** A new item, row, or stroke. */
export function newId(): string {
  return randomId("item");
}
