import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Nearly every test boots its own in-memory Postgres, and the first boot in
    // a worker compiles the WASM module. On a busy machine that can pass the
    // default five seconds without anything being wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
