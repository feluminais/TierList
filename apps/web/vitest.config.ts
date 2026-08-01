import { defineConfig } from "vitest/config";

/**
 * `apps/web` earns a test task for exactly one reason: `useAutosave` is a React
 * effect whose failure mode is silence, and it cannot be exercised in the
 * browser at all while no API is connected. A fake client and a real React
 * lifecycle is the only place its behaviour is observable.
 *
 * Deliberately narrow — `test/` only, so nothing here tries to render Skia.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "jsdom",
    // See test/setup.ts: jsdom's Blob/File cannot read their own bytes, which
    // useAssetUpload's tests need.
    setupFiles: ["./test/setup.ts"],
  },
});
