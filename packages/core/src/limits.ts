/**
 * Upper bounds on what a document may hold.
 *
 * Each sits far above anything the editor produces. They exist so that one
 * hand-written document cannot make every reader of it — the share page, the
 * editor, everyone filling a template — allocate, lay out or download
 * something unbounded.
 *
 * Two places enforce them, and they must agree: `validateDocument` refuses a
 * document past any of them, and `reduce` never produces one — so an edit made
 * in any editor always yields a document the API will accept.
 */
export const DOCUMENT_LIMITS = {
  idLength: 128,
  titleLength: 200,
  descriptionLength: 2000,
  rowLabelLength: 100,
  itemLabelLength: 300,
  rows: 64,
  items: 2000,
  strokesPerSurface: 1000,
  /** Numbers, not points: a stroke is a flat `[x0, y0, x1, y1, …]` list. */
  strokeCoordinates: 8192,
  tileSize: 1024,
  labelWidth: 2048,
} as const;

/**
 * `text` cut to at most `max` UTF-16 code units — the measure the limits use —
 * without splitting a surrogate pair, so an emoji at the cut is dropped whole
 * rather than left as half a character.
 */
export function fitText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}
