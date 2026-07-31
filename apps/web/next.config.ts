import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@tl/editor-spike",
    "@shopify/react-native-skia",
    "react-native-web",
  ],
  turbopack: {
    root: path.resolve(process.cwd(), "..", ".."),
    resolveAlias: {
      "react-native": "react-native-web",
      // `@tl/editor-spike` has an intentionally empty manifest and no
      // node_modules of its own, so bare specifiers in its source cannot be
      // resolved by walking up from packages/editor-spike/.
      "@shopify/react-native-skia": "./node_modules/@shopify/react-native-skia",
      // Skia's Platform.web.js reaches into react-native's internal asset
      // registry; react-native-web ships the same module with getAssetByID.
      "react-native/Libraries/Image/AssetRegistry":
        "react-native-web/dist/modules/AssetRegistry",
      // Dead Node-only branch inside the canvaskit Emscripten glue.
      fs: { browser: "./stubs/empty.js" },
      path: { browser: "./stubs/empty.js" },
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
