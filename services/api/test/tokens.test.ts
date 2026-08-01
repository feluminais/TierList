import { describe, expect, it } from "vitest";
import { generateToken, hashToken, isValidTokenFormat } from "../src/tokens";

describe("generateToken", () => {
  it("returns a distinct value each call", () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(seen.size).toBe(100);
  });

  it("returns a url-safe string of stable length", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(43);
  });
});

describe("hashToken", () => {
  it("is deterministic", () => {
    const token = generateToken();
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("produces different hashes for different tokens", () => {
    expect(hashToken(generateToken())).not.toBe(hashToken(generateToken()));
  });

  it("does not contain the token", () => {
    const token = generateToken();
    expect(hashToken(token)).not.toContain(token);
  });

  it("returns a 64-character hex digest", () => {
    expect(hashToken(generateToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isValidTokenFormat", () => {
  it("accepts a generated token", () => {
    expect(isValidTokenFormat(generateToken())).toBe(true);
  });

  it("rejects malformed input without hashing it", () => {
    expect(isValidTokenFormat("")).toBe(false);
    expect(isValidTokenFormat("short")).toBe(false);
    expect(
      isValidTokenFormat("has spaces in it and is quite long indeed yes"),
    ).toBe(false);
    expect(isValidTokenFormat("a".repeat(500))).toBe(false);
  });
});
