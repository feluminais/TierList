import { describe, expect, it } from "vitest";
import { parseTrustedProxyHops } from "../src/config";

describe("parseTrustedProxyHops", () => {
  it("is 0 when the variable is not set, so a forged header is ignored by default", () => {
    expect(parseTrustedProxyHops(undefined)).toBe(0);
    expect(parseTrustedProxyHops("")).toBe(0);
    expect(parseTrustedProxyHops("  ")).toBe(0);
  });

  it("reads a whole number of proxies", () => {
    expect(parseTrustedProxyHops("1")).toBe(1);
    expect(parseTrustedProxyHops(" 2 ")).toBe(2);
    expect(parseTrustedProxyHops("0")).toBe(0);
  });

  it.each(["-1", "1.5", "two", "1e2", "0x1", "NaN", "Infinity", "1 2"])(
    "refuses %j rather than guessing",
    (raw) => {
      expect(() => parseTrustedProxyHops(raw)).toThrow(/TRUSTED_PROXY_HOPS/);
    },
  );

  it("refuses an absurd count, which would read an address no proxy wrote", () => {
    expect(() => parseTrustedProxyHops("9")).toThrow(/TRUSTED_PROXY_HOPS/);
  });
});
