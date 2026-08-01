import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const MIN_LENGTH = 43;
const MAX_LENGTH = 64;

/** A fresh opaque bearer token. 256 bits of entropy, url-safe. */
export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Tokens are stored hashed so a database leak does not hand over live
 * credentials. SHA-256 without a salt is correct here and deliberate: these are
 * high-entropy random values, not passwords, so there is nothing to brute-force
 * and no dictionary to defend against. Do not "improve" this to bcrypt — that
 * would add per-request cost for no benefit.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check so obvious junk never reaches the database. */
export function isValidTokenFormat(token: string): boolean {
  return (
    token.length >= MIN_LENGTH &&
    token.length <= MAX_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(token)
  );
}
