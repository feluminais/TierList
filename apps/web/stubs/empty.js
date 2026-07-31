// Browser-side stub for Node built-ins (`fs`, `path`) that the Emscripten glue
// in `canvaskit-wasm/bin/full/canvaskit.js` references from a Node-only branch
// (`if (isNode) { var fs = require("fs"); require("path"); ... }`). The branch is
// dead in the browser, but Turbopack still resolves the requires statically.
export default {};
