import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { addressKey, createLimiter, MAX_TRACKED_KEYS } from "../src/ratelimit";
import { createRepository } from "../src/repository";
import { createMemoryStore } from "../src/store";
import { pngBytes } from "./helpers/images";
import { createTestDb, type TestDb } from "./helpers/pglite";

describe("createLimiter", () => {
  it("allows up to the limit, then refuses with the seconds left in the window", () => {
    let now = 0;
    const limiter = createLimiter({ limit: 3, windowMs: 60_000 }, () => now);

    for (let i = 0; i < 3; i++) expect(limiter.check("a").allowed).toBe(true);
    now = 20_500;
    expect(limiter.check("a")).toEqual({ allowed: false, retryAfterSeconds: 40 });
  });

  it("starts a fresh window once the old one has ended", () => {
    let now = 0;
    const limiter = createLimiter({ limit: 1, windowMs: 1000 }, () => now);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
    now = 1000;
    expect(limiter.check("a").allowed).toBe(true);
  });

  it("counts each key on its own", () => {
    const limiter = createLimiter({ limit: 1, windowMs: 1000 }, () => 0);
    expect(limiter.check("a").allowed).toBe(true);
    expect(limiter.check("b").allowed).toBe(true);
    expect(limiter.check("a").allowed).toBe(false);
  });

  it("never reports a wait shorter than one second", () => {
    let now = 0;
    const limiter = createLimiter({ limit: 1, windowMs: 1000 }, () => now);
    limiter.check("a");
    now = 999.9;
    expect(limiter.check("a").retryAfterSeconds).toBe(1);
  });

  it("stays bounded under a flood of distinct keys, still limiting the recent ones", () => {
    const limiter = createLimiter({ limit: 1, windowMs: 60_000 }, () => 0);
    for (let i = 0; i < MAX_TRACKED_KEYS + 500; i++) limiter.check(`k${i}`);
    // The newest key is still tracked, so its second request is refused.
    expect(limiter.check(`k${MAX_TRACKED_KEYS + 499}`).allowed).toBe(false);
    // The oldest were forgiven rather than growing the table.
    expect(limiter.check("k0").allowed).toBe(true);
  });
});

describe("addressKey", () => {
  it("leaves an IPv4 address alone, and reads one mapped into IPv6 as the IPv4 address", () => {
    expect(addressKey("203.0.113.9")).toBe("203.0.113.9");
    expect(addressKey("::ffff:203.0.113.9")).toBe("203.0.113.9");
  });

  it("keys an IPv6 address by its /64, which is what one subscriber holds", () => {
    const a = addressKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    const b = addressKey("2001:db8:1:2:1:2:3:4");
    expect(a).toBe(b);
    expect(a).toBe("2001:db8:1:2::/64");
    expect(addressKey("2001:db8:1:3::1")).not.toBe(a);
  });

  it("expands a compressed address before taking the prefix", () => {
    expect(addressKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(addressKey("::1")).toBe("0:0:0:0::/64");
    expect(addressKey("2001:DB8:0:0:0:0:0:1")).toBe("2001:db8:0:0::/64");
  });

  it("passes through what it cannot read as an address", () => {
    expect(addressKey("unknown")).toBe("unknown");
    expect(addressKey("not an address")).toBe("not an address");
  });
});

describe("rate limits on the API", () => {
  let testDb: TestDb;
  let now: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    now = 1_000_000;
  });

  afterEach(async () => {
    await testDb.close();
  });

  const app = (options: Parameters<typeof buildApp>[1] = {}) =>
    buildApp(
      { repository: createRepository(testDb.db), store: createMemoryStore() },
      { clock: () => now, ...options },
    );

  const mint = (a: ReturnType<typeof buildApp>, headers: Record<string, string> = {}) =>
    a.request("/tokens", { method: "POST", headers });

  it("answers 429 with Retry-After and a JSON body past a class's limit", async () => {
    const a = app({ rateLimits: { tokens: { limit: 2, windowMs: 60_000 } } });
    expect((await mint(a)).status).toBe(201);
    expect((await mint(a)).status).toBe(201);

    now += 15_000;
    const refused = await mint(a);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).toBe("45");
    await expect(refused.json()).resolves.toEqual({ error: "too many requests" });
  });

  it("serves again once the window has passed", async () => {
    const a = app({ rateLimits: { tokens: { limit: 1, windowMs: 60_000 } } });
    expect((await mint(a)).status).toBe(201);
    expect((await mint(a)).status).toBe(429);
    now += 60_000;
    expect((await mint(a)).status).toBe(201);
  });

  it("carries CORS headers on the 429, so a browser can read it", async () => {
    const a = app({ rateLimits: { tokens: { limit: 1, windowMs: 60_000 } } });
    await mint(a, { origin: "http://localhost:3000" });
    const refused = await mint(a, { origin: "http://localhost:3000" });
    expect(refused.status).toBe(429);
    expect(refused.headers.get("access-control-allow-origin")).toBeTruthy();
  });

  it("limits each class separately", async () => {
    const a = app({
      rateLimits: { tokens: { limit: 1, windowMs: 60_000 }, reads: { limit: 5, windowMs: 60_000 } },
    });
    await mint(a);
    expect((await mint(a)).status).toBe(429);
    expect((await a.request("/browse")).status).toBe(200);
  });

  it("limits uploads by their own class", async () => {
    const a = app({ rateLimits: { uploads: { limit: 1, windowMs: 60_000 } } });
    const { token } = (await (await mint(a)).json()) as { token: string };
    const upload = (n: number) =>
      a.request("/assets", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: pngBytes(n, n),
      });
    expect((await upload(4)).status).toBe(201);
    expect((await upload(5)).status).toBe(429);
  });

  it("limits share-code lookups, which are how a code could be guessed", async () => {
    const a = app({ rateLimits: { shareLookup: { limit: 2, windowMs: 60_000 } } });
    expect((await a.request("/shares/0000000000")).status).toBe(404);
    expect((await a.request("/shares/0000000001")).status).toBe(404);
    expect((await a.request("/shares/0000000002")).status).toBe(429);
  });

  it("does not limit /health", async () => {
    const a = app({ rateLimits: { reads: { limit: 1, windowMs: 60_000 } } });
    for (let i = 0; i < 5; i++) expect((await a.request("/health")).status).toBe(200);
  });

  describe("the client address", () => {
    const tight = { tokens: { limit: 1, windowMs: 60_000 } };

    it("ignores X-Forwarded-For by default, so a caller cannot choose a fresh bucket", async () => {
      const a = app({ rateLimits: tight });
      expect((await mint(a, { "x-forwarded-for": "1.1.1.1" })).status).toBe(201);
      expect((await mint(a, { "x-forwarded-for": "2.2.2.2" })).status).toBe(429);
    });

    it("reads the entry the trusted proxy appended, not the ones the client wrote", async () => {
      const a = app({ rateLimits: tight, trustedProxyHops: 1 });
      expect((await mint(a, { "x-forwarded-for": "9.9.9.9, 10.0.0.1" })).status).toBe(201);
      // A different forged left entry, the same address behind the proxy.
      expect((await mint(a, { "x-forwarded-for": "8.8.8.8, 10.0.0.1" })).status).toBe(429);
      // A different address behind the proxy is a different client.
      expect((await mint(a, { "x-forwarded-for": "9.9.9.9, 10.0.0.2" })).status).toBe(201);
    });

    it("counts two trusted hops from the right", async () => {
      const a = app({ rateLimits: tight, trustedProxyHops: 2 });
      expect((await mint(a, { "x-forwarded-for": "7.7.7.7, 10.0.0.5, 10.0.0.1" })).status).toBe(201);
      expect((await mint(a, { "x-forwarded-for": "6.6.6.6, 10.0.0.5, 10.0.0.9" })).status).toBe(429);
    });
  });
});
