import { describe, expect, it, vi } from "vitest";
import { createDb } from "../src/db";

describe("createDb", () => {
  it("hears an error on an idle pooled connection instead of letting it kill the process", async () => {
    const heard: Error[] = [];
    const { pool, close } = createDb("postgres://nobody@localhost:1/none", (e) => heard.push(e));

    // An emitted `error` with no listener throws; with one it is handled.
    expect(() => pool.emit("error", new Error("terminating connection"))).not.toThrow();
    expect(heard.map((e) => e.message)).toEqual(["terminating connection"]);
    await close();
  });

  it("survives such an error even when the caller gave no handler", async () => {
    const { pool, close } = createDb("postgres://nobody@localhost:1/none");
    expect(() => pool.emit("error", new Error("x"))).not.toThrow();
    await close();
    vi.restoreAllMocks();
  });
});
