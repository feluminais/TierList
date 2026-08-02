import { randomBytes } from "node:crypto";

/**
 * Crockford's base32 alphabet: no `I`, `L`, `O` or `U`.
 *
 * The first three are excluded because a share code gets read aloud, typed
 * from a screenshot and pasted out of a chat window, and `1/I/l` and `0/O` are
 * the pairs that go wrong when it does. `U` is excluded so the alphabet cannot
 * spell the short obscenities that a random generator will otherwise produce
 * at a rate nobody wants to explain.
 *
 * The design doc specifies "8-character base32", which this is: 32 symbols,
 * 5 bits each, 40 bits of code space — about a trillion, so a random guess
 * finds a list with probability far below the rate at which anything else in
 * this service would fail first.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 8;

/** How many characters a code may have. Shape check for an untrusted path. */
const CODE_PATTERN = /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$/;

/**
 * A fresh share code.
 *
 * Bytes come from `randomBytes` rather than `Math.random`: a code is the only
 * thing standing between a private list and a stranger, and a predictable
 * sequence would let one enumerate the others from a single published link.
 *
 * One byte per character with a modulo would bias the first 8 symbols of the
 * alphabet slightly (256 is not a multiple of 32). Masking to 5 bits and
 * taking one symbol per byte is unbiased and costs nothing here.
 */
export function generateShareCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += ALPHABET[bytes[i]! & 31];
  }
  return out;
}

/**
 * Whether a string could be a code this service issued.
 *
 * The same reasoning as `isPlausibleAssetId` in routes.ts: reject what could
 * never have been generated here before it reaches the database, so a lookup
 * is spent only on something that might exist. Case is not normalised —
 * codes are issued upper-case and a lower-case one is simply not a code —
 * because a case-insensitive lookup would make two distinct strings name one
 * row, which is the class of bug `assertSafeKey` and the lowercase-only
 * object store keys already exist to foreclose.
 */
export function isPlausibleShareCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}
