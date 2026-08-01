import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@shopify/react-native-skia",
    "react-native-web",
  ],
  turbopack: {
    // Derived from this file's location, not process.cwd(): the cwd-relative
    // form silently produced a wrong root (and a "couldn't find the Next.js
    // package" warning) when the dev server was launched from another
    // directory.
    root: path.resolve(__dirname, "..", ".."),
    resolveAlias: {
      "react-native": "react-native-web",
      // Skia's Platform.web.js reaches into react-native's internal asset
      // registry; react-native-web ships the same module with getAssetByID.
      "react-native/Libraries/Image/AssetRegistry":
        "react-native-web/dist/modules/AssetRegistry",
      // Dead Node-only branch inside the canvaskit Emscripten glue
      // (`if (isNode) { require("fs"); require("path"); ... }`), which
      // Turbopack still resolves statically for the browser bundle.
      fs: { browser: "./stubs/empty.js" },
      path: { browser: "./stubs/empty.js" },
      // Skia's ReanimatedProxy try/catch-requires react-native-reanimated and
      // falls back when it throws. apps/mobile made reanimated resolvable, so
      // Turbopack started following that require into raw React Native Flow
      // source. A runtime try/catch does not prune a static import graph.
      // Unconditional rather than `{ browser }`: the server graph reaches it
      // too, through the Server Component pass over any route that renders a
      // Skia component.
      "react-native-reanimated": "./stubs/reanimated-absent.js",
    },
    resolveExtensions: [
      ".web.tsx",
      ".web.ts",
      ".web.jsx",
      ".web.js",
      ".tsx",
      ".ts",
      ".jsx",
      ".js",
      ".mjs",
      ".json",
    ],
  },
};

export default nextConfig;
