/**
 * jsdom's `Blob`/`File` do not implement `arrayBuffer()`, `text()` or
 * `stream()` (https://github.com/jsdom/jsdom/issues/2555) — only `slice()`,
 * `size` and `type`. `useAssetUpload` reads a picked file via
 * `file.arrayBuffer()`, which is exactly the gap, so every one of its tests
 * would fail on "file.arrayBuffer is not a function" regardless of what the
 * hook does.
 *
 * Node's own `Blob`/`File` (global since Node 20, spec-compliant) implement
 * the read methods and are otherwise interchangeable, so tests get those
 * instead of jsdom's.
 */
import { Blob, File } from "node:buffer";

globalThis.Blob = Blob as unknown as typeof globalThis.Blob;
globalThis.File = File as unknown as typeof globalThis.File;
