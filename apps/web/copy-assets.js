// Copies the large, regenerable binaries the canvas needs into public/.
// Gitignored: 8MB of WASM does not belong in history, and a manual one-off
// command means a fresh clone silently 404s instead.

const fs = require("fs");
const path = require("path");

const publicFolder = path.join(process.cwd(), "public");
fs.mkdirSync(publicFolder, { recursive: true });

// Resolved from Skia's own location rather than the app's, so the copy always
// matches the canvaskit build that Skia was compiled against.
const wasmSrc = require.resolve("canvaskit-wasm/bin/full/canvaskit.wasm", {
  paths: [require.resolve("@shopify/react-native-skia")],
});

fs.copyFileSync(wasmSrc, path.join(publicFolder, "canvaskit.wasm"));

// The browser has no Metro asset registry, so `useFont` takes a URL and the
// .ttf has to be served as a static file. Resolved through require.resolve so
// a package layout change fails loudly here rather than as a blank label —
// note the weight lives in its own directory, not at the package root.
// Resolved from @tl/editor's location because that is the package that
// declares the dependency; apps/web only needs the bytes.
const fontSrc = require.resolve(
  "@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf",
  { paths: [require.resolve("@tl/editor/package.json")] },
);

fs.copyFileSync(fontSrc, path.join(publicFolder, "Inter-Regular.ttf"));
