import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app";
import { createRepository, type Repository } from "../src/repository";
import { createShutdown, type ClosableServer } from "../src/shutdown";
import { createMemoryStore } from "../src/store";
import { createTestDb, type TestDb } from "./helpers/pglite";

type Entry = Record<string, unknown>;

describe("GET /health with a repository", () => {
  let testDb: TestDb;
  let repository: Repository;

  beforeEach(async () => {
    testDb = await createTestDb();
    repository = createRepository(testDb.db);
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("answers ok when the database answers", async () => {
    const app = buildApp({ repository, store: createMemoryStore() });
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ status: "ok" });
  });

  it("answers 503 when the database refuses the query", async () => {
    const broken: Repository = {
      ...repository,
      ping: () => Promise.reject(new Error("connection refused")),
    };
    const app = buildApp({ repository: broken, store: createMemoryStore() });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({ status: "unavailable" });
  });

  it("answers 503 when the database does not answer in time", async () => {
    const hung: Repository = { ...repository, ping: () => new Promise<void>(() => {}) };
    const app = buildApp({ repository: hung, store: createMemoryStore() }, { healthTimeoutMs: 20 });
    const res = await app.request("/health");
    expect(res.status).toBe(503);
  });
});

describe("request logging", () => {
  let testDb: TestDb;
  let repository: Repository;
  let entries: Entry[];
  let tick: number;

  const options = () => ({
    log: (entry: Entry) => entries.push(entry),
    clock: () => tick,
  });

  beforeEach(async () => {
    testDb = await createTestDb();
    repository = createRepository(testDb.db);
    entries = [];
    tick = 1_000;
  });

  afterEach(async () => {
    await testDb.close();
  });

  it("writes one line per request, with the route pattern rather than the path", async () => {
    // Looking the list up takes 7ms on the clock, so the duration is known.
    const slow: Repository = {
      ...repository,
      load: async () => {
        tick += 7;
        return null;
      },
    };
    const app = buildApp({ repository: slow, store: createMemoryStore() }, options());
    const res = await app.request("/lists/some-private-id");
    expect(res.status).toBe(404);

    const requests = entries.filter((e) => e.event === "request");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      level: "info",
      method: "GET",
      route: "/lists/:id",
      status: 404,
      durationMs: 7,
    });
    // An id or a share code in a path is a credential to read that list; the
    // log names the route instead.
    expect(JSON.stringify(entries)).not.toContain("some-private-id");
  });

  it("gives each request an id, in the log and in the response", async () => {
    const app = buildApp({ repository, store: createMemoryStore() }, options());
    const a = await app.request("/health");
    const b = await app.request("/health");
    const ids = entries.filter((e) => e.event === "request").map((e) => e.requestId);
    expect(ids[0]).toBe(a.headers.get("x-request-id"));
    expect(ids[1]).toBe(b.headers.get("x-request-id"));
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("ignores a request id the caller supplies", async () => {
    const app = buildApp({ repository, store: createMemoryStore() }, options());
    const res = await app.request("/health", { headers: { "x-request-id": "forged" } });
    expect(res.headers.get("x-request-id")).not.toBe("forged");
  });

  it("never writes a bearer token or a request body", async () => {
    const app = buildApp({ repository, store: createMemoryStore() }, options());
    const minted = await app.request("/tokens", { method: "POST" });
    const { token } = (await minted.json()) as { token: string };
    await app.request("/lists", { headers: { authorization: `Bearer ${token}` } });
    expect(JSON.stringify(entries)).not.toContain(token);
  });

  it("turns an uncaught error into a 500 and one error line sharing the request's id", async () => {
    const throwing: Repository = {
      ...repository,
      load: () => Promise.reject(new Error("database exploded")),
    };
    const app = buildApp({ repository: throwing, store: createMemoryStore() }, options());
    const res = await app.request("/lists/abc");

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "internal error" });

    const failure = entries.find((e) => e.event === "error");
    expect(failure).toMatchObject({
      level: "error",
      message: "database exploded",
      route: "/lists/:id",
      requestId: res.headers.get("x-request-id"),
    });
    expect(typeof failure?.stack).toBe("string");

    const request = entries.find((e) => e.event === "request");
    expect(request).toMatchObject({ status: 500, requestId: res.headers.get("x-request-id") });
  });

  it("logs nothing when no sink is given", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const app = buildApp({ repository, store: createMemoryStore() });
    await app.request("/health");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("createShutdown", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakeServer() {
    let finishClose: (error?: Error) => void = () => {};
    const calls: string[] = [];
    const server: ClosableServer = {
      close: (callback) => {
        calls.push("close");
        finishClose = callback ?? (() => {});
      },
      closeIdleConnections: () => calls.push("closeIdle"),
      closeAllConnections: () => calls.push("closeAll"),
    };
    return { server, calls, finish: () => finishClose() };
  }

  it("stops accepting, waits for in-flight requests, closes the database, then exits 0", async () => {
    vi.useFakeTimers();
    const { server, calls, finish } = fakeServer();
    const order: string[] = [];
    const exit = vi.fn((code: number) => order.push(`exit ${code}`));
    const shutdown = createShutdown({
      server,
      closeDb: async () => {
        order.push("db closed");
      },
      log: (entry) => order.push(`log ${String(entry.event)}`),
      exit,
      timeoutMs: 10_000,
    });

    const done = shutdown("SIGTERM");
    await vi.advanceTimersByTimeAsync(100);
    // Still draining: the database must stay open for requests in flight.
    expect(calls).toEqual(["close", "closeIdle"]);
    expect(order).toEqual(["log shutdown"]);

    finish();
    await done;

    expect(order).toEqual(["log shutdown", "db closed", "exit 0"]);
    expect(calls).not.toContain("closeAll");
  });

  it("closes lingering connections once the grace period passes, and exits 1", async () => {
    vi.useFakeTimers();
    const { server, calls, finish } = fakeServer();
    const exit = vi.fn();
    const shutdown = createShutdown({
      server,
      closeDb: async () => {},
      log: () => {},
      exit,
      timeoutMs: 5_000,
    });

    const done = shutdown("SIGINT");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(calls).toContain("closeAll");

    finish();
    await done;
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("does nothing for a second signal while the first is running", async () => {
    vi.useFakeTimers();
    const { server, calls, finish } = fakeServer();
    const shutdown = createShutdown({
      server,
      closeDb: async () => {},
      log: () => {},
      exit: () => {},
      timeoutMs: 10_000,
    });

    const first = shutdown("SIGTERM");
    const second = shutdown("SIGTERM");
    finish();
    await Promise.all([first, second]);
    expect(calls.filter((c) => c === "close")).toHaveLength(1);
  });

  it("exits 1 and says why when the database will not close", async () => {
    vi.useFakeTimers();
    const { server, finish } = fakeServer();
    const entries: Entry[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      server,
      closeDb: () => Promise.reject(new Error("pool stuck")),
      log: (entry) => entries.push(entry),
      exit,
      timeoutMs: 10_000,
    });

    const done = shutdown("SIGTERM");
    finish();
    await done;
    expect(exit).toHaveBeenCalledWith(1);
    expect(entries.find((e) => e.level === "error")).toMatchObject({ message: "pool stuck" });
  });
});
