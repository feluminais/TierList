import { useFont, useTypeface } from "@shopify/react-native-skia";
import type { SkFont, SkTypeface } from "@shopify/react-native-skia";

/**
 * On the web the font is served as a static asset rather than bundled — the
 * browser has no Metro asset registry, and `useFont` accepts a URL directly
 * (`DataSource` includes a bare `string`). Both weights are copied into
 * apps/web/public at install time by copy-assets.js.
 *
 * Selected over useBoardFont.ts by the `.web.ts` entry in next.config.ts's
 * `resolveExtensions`.
 */
export function useBoardFont(size: number, bold = false): SkFont | null {
  return useFont(bold ? "/Inter-Bold.ttf" : "/Inter-Regular.ttf", size);
}

/**
 * The face on its own, for making fonts at other sizes.
 *
 * Loaded rather than read back from a live `SkFont`: CanvasKit's
 * `Font.getTypeface()` hands out a bare pointer, and a font cannot be built
 * from one ("Passing raw pointer to smart pointer is illegal").
 */
export function useBoardTypeface(bold = false): SkTypeface | null {
  return useTypeface(bold ? "/Inter-Bold.ttf" : "/Inter-Regular.ttf");
}
