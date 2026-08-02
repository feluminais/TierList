"use client";

/**
 * Turn a title into something a filesystem will accept.
 *
 * Deliberately conservative — anything outside letters, digits, spaces and
 * dashes goes — because this string reaches a `download` attribute, and a
 * browser saving `S/A/B tier.png` on a POSIX filesystem is the kind of failure
 * that shows up as a silently truncated name rather than an error.
 */
export function filenameFor(title: string, extension: string): string {
  const cleaned = title
    .replace(/[^\p{L}\p{N} \-_]/gu, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${cleaned || "tier-list"}.${extension}`;
}

/**
 * Hand bytes to the browser as a file.
 *
 * The object URL is revoked on the next macrotask rather than immediately:
 * the click is dispatched synchronously, but the browser reads the URL
 * afterwards, and revoking in the same tick cancels the download in Firefox.
 * A timeout of zero is enough — this only has to leave the current task.
 */
export function downloadBytes(
  bytes: Uint8Array | string,
  contentType: string,
  filename: string,
): void {
  // `new Blob([...])` rejects a `Uint8Array<ArrayBufferLike>` under the DOM
  // lib's `BlobPart` union in TS 5.9, though every browser accepts one. The
  // cast is confined to this one line rather than spread over the callers.
  const blob = new Blob([bytes as BlobPart], { type: contentType });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  // Appended before clicking: a detached anchor's click is ignored in Firefox.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 0);
}
