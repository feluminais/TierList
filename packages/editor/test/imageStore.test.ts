import { describe, expect, it } from "vitest";
import { createImageStore, type ImageStore } from "../src/imageStore";

/** A scheduler the test drives by hand. */
function fakeClock() {
  let now = 0;
  const pending: { at: number; run: () => void; id: number; live: boolean }[] = [];
  let next = 1;
  return {
    schedule: (run: () => void, ms: number) => {
      const entry = { at: now + ms, run, id: next++, live: true };
      pending.push(entry);
      return entry.id;
    },
    cancel: (id: unknown) => {
      const entry = pending.find((p) => p.id === id);
      if (entry) entry.live = false;
    },
    advance(ms: number) {
      now += ms;
      for (const entry of pending.filter((p) => p.live && p.at <= now).sort((a, b) => a.at - b.at)) {
        entry.live = false;
        entry.run();
      }
    },
    liveTimers: () => pending.filter((p) => p.live).length,
  };
}

/** A loader whose requests the test settles one at a time. */
function fakeLoader() {
  const requests: { id: string; resolve: (image: string | null) => void; reject: (e: unknown) => void }[] = [];
  return {
    requests,
    load: (id: string) =>
      new Promise<string | null>((resolve, reject) => {
        requests.push({ id, resolve, reject });
      }),
    byId: (id: string) => requests.filter((r) => r.id === id),
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function make(options: { maxEntries?: number; retryDelaysMs?: number[]; releaseDelayMs?: number } = {}) {
  const clock = fakeClock();
  const loader = fakeLoader();
  const released: string[] = [];
  let changes = 0;
  const store: ImageStore<string> = createImageStore<string>({
    load: loader.load,
    release: (image) => released.push(image),
    onChange: () => changes++,
    schedule: clock.schedule,
    cancel: clock.cancel,
    maxEntries: options.maxEntries ?? 3,
    retryDelaysMs: options.retryDelaysMs ?? [1000, 5000],
    releaseDelayMs: options.releaseDelayMs ?? 500,
  });
  return { store, clock, loader, released, changes: () => changes };
}

describe("loading", () => {
  it("starts one load per wanted asset, and reports it as loading", () => {
    const { store, loader } = make();
    store.want(["a", "b"]);
    expect(loader.requests.map((r) => r.id)).toEqual(["a", "b"]);
    expect(store.get("a")).toEqual({ status: "loading" });
    expect(store.get("nope")).toBeUndefined();
  });

  it("does not load an asset twice", () => {
    const { store, loader } = make();
    store.want(["a"]);
    store.want(["a", "b"]);
    expect(loader.byId("a")).toHaveLength(1);
  });

  it("turns a decoded image into a ready entry and says so", async () => {
    const { store, loader, changes } = make();
    store.want(["a"]);
    loader.requests[0]!.resolve("img-a");
    await settle();
    expect(store.get("a")).toEqual({ status: "ready", image: "img-a" });
    expect(changes()).toBeGreaterThan(0);
  });
});

describe("failure and retry", () => {
  it("reports a failed load, then retries after the first delay", async () => {
    const { store, loader, clock } = make();
    store.want(["a"]);
    loader.requests[0]!.reject(new Error("network"));
    await settle();
    expect(store.get("a")).toEqual({ status: "failed" });

    clock.advance(999);
    expect(loader.byId("a")).toHaveLength(1);
    clock.advance(1);
    expect(loader.byId("a")).toHaveLength(2);
  });

  it("treats an image that cannot be decoded as a failure too", async () => {
    const { store, loader, clock } = make();
    store.want(["a"]);
    loader.requests[0]!.resolve(null);
    await settle();
    expect(store.get("a")).toEqual({ status: "failed" });
    expect(clock.liveTimers()).toBe(1);
  });

  it("becomes ready when a retry succeeds", async () => {
    const { store, loader, clock } = make();
    store.want(["a"]);
    loader.requests[0]!.reject(new Error("x"));
    await settle();
    clock.advance(1000);
    loader.byId("a")[1]!.resolve("img-a");
    await settle();
    expect(store.get("a")).toEqual({ status: "ready", image: "img-a" });
  });

  it("backs off, then gives up after the last delay and stays failed", async () => {
    const { store, loader, clock } = make({ retryDelaysMs: [1000, 5000] });
    store.want(["a"]);
    loader.requests[0]!.reject(new Error("x"));
    await settle();
    clock.advance(1000);
    loader.byId("a")[1]!.reject(new Error("x"));
    await settle();
    clock.advance(4999);
    expect(loader.byId("a")).toHaveLength(2);
    clock.advance(1);
    expect(loader.byId("a")).toHaveLength(3);
    loader.byId("a")[2]!.reject(new Error("x"));
    await settle();

    expect(clock.liveTimers()).toBe(0);
    expect(store.get("a")).toEqual({ status: "failed" });
  });

  it("does not retry an asset that is no longer wanted", async () => {
    const { store, loader, clock } = make();
    store.want(["a"]);
    loader.requests[0]!.reject(new Error("x"));
    await settle();
    store.want([]);
    clock.advance(1000);
    expect(loader.byId("a")).toHaveLength(1);
  });
});

describe("a retry in flight", () => {
  it("is not joined by a second load when its tile leaves the board and comes back", async () => {
    const { store, loader, clock } = make({ retryDelaysMs: [1000] });
    store.want(["a"]);
    loader.requests[0]!.reject(new Error("x"));
    await settle();
    clock.advance(1000);
    expect(loader.byId("a")).toHaveLength(2); // the retry is in flight

    store.want([]);
    store.want(["a"]);
    expect(loader.byId("a")).toHaveLength(2);

    // And its result is kept, not overwritten by a second request's failure.
    loader.byId("a")[1]!.resolve("img-a");
    await settle();
    expect(store.get("a")).toEqual({ status: "ready", image: "img-a" });
  });
});

describe("a failure left behind", () => {
  it("starts afresh when its tile comes back after being off the board", async () => {
    const { store, loader, clock } = make({ retryDelaysMs: [1000] });
    store.want(["a"]);
    loader.requests[0]!.reject(new Error("x"));
    await settle();
    store.want([]);
    clock.advance(1000); // the retry fires, finds it unwanted and does nothing
    expect(loader.byId("a")).toHaveLength(1);

    store.want(["a"]);
    expect(loader.byId("a")).toHaveLength(2);
    expect(store.get("a")).toEqual({ status: "loading" });
  });

  it("is not restarted by later changes while it stays on the board", async () => {
    const { store, loader, clock } = make({ retryDelaysMs: [] });
    store.want(["a"]);
    loader.requests[0]!.reject(new Error("x"));
    await settle();
    expect(clock.liveTimers()).toBe(0);

    store.want(["a", "b"]);
    store.want(["a", "b", "c"]);
    expect(loader.byId("a")).toHaveLength(1);
  });
});

describe("eviction", () => {
  async function filled(ids: string[], options: Parameters<typeof make>[0] = {}) {
    const made = make(options);
    made.store.want(ids);
    for (const id of ids) made.loader.byId(id)[0]!.resolve(`img-${id}`);
    await settle();
    return made;
  }

  it("keeps everything wanted, however many, because it is on the board", async () => {
    const { store } = await filled(["a", "b", "c", "d", "e"], { maxEntries: 3 });
    for (const id of ["a", "b", "c", "d", "e"]) expect(store.get(id)?.status).toBe("ready");
  });

  it("drops the least recently wanted entry that is no longer on the board, past the cap", async () => {
    const { store } = await filled(["a", "b", "c"], { maxEntries: 3 });
    store.want(["d"]);
    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")?.status).toBe("ready");
    expect(store.get("d")).toEqual({ status: "loading" });
  });

  it("counts wanting an asset again as using it", async () => {
    const { store } = await filled(["a", "b", "c"], { maxEntries: 3 });
    store.want(["a"]); // a is now the most recently used; b is the oldest
    store.want(["d"]);
    expect(store.get("b")).toBeUndefined();
    expect(store.get("a")?.status).toBe("ready");
  });

  it("releases an evicted image, after a grace period rather than at once", async () => {
    const { store, clock, released } = await filled(["a", "b", "c"], { maxEntries: 3, releaseDelayMs: 500 });
    store.want(["d"]);
    expect(released).toEqual([]);
    clock.advance(499);
    expect(released).toEqual([]);
    clock.advance(1);
    expect(released).toEqual(["img-a"]);
  });

  it("releases an image whose load finishes after it was evicted", async () => {
    const { store, loader, clock, released } = make({ maxEntries: 1 });
    store.want(["a"]);
    store.want(["b"]);
    expect(store.get("a")).toBeUndefined();

    loader.byId("a")[0]!.resolve("img-a");
    await settle();
    clock.advance(500);
    expect(released).toEqual(["img-a"]);
    expect(store.get("a")).toBeUndefined();
  });

  it("loads an evicted asset afresh when it is wanted again", async () => {
    const { store, loader } = await filled(["a", "b", "c"], { maxEntries: 3 });
    store.want(["d"]);
    store.want(["a"]);
    expect(loader.byId("a")).toHaveLength(2);
  });
});

describe("dispose", () => {
  it("releases every image and cancels every pending retry", async () => {
    const { store, loader, clock, released } = make();
    store.want(["a", "b"]);
    loader.byId("a")[0]!.resolve("img-a");
    loader.byId("b")[0]!.reject(new Error("x"));
    await settle();
    expect(clock.liveTimers()).toBe(1);

    store.dispose();
    expect(released).toEqual(["img-a"]);
    expect(clock.liveTimers()).toBe(0);
  });

  it("releases an image that arrives after disposal, and stays quiet", async () => {
    const { store, loader, released, changes } = make();
    store.want(["a"]);
    store.dispose();
    const before = changes();
    loader.byId("a")[0]!.resolve("img-a");
    await settle();
    expect(released).toEqual(["img-a"]);
    expect(changes()).toBe(before);
  });
});
