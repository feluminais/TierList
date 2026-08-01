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
