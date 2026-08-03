import { useFont } from "@shopify/react-native-skia";
import type { SkFont } from "@shopify/react-native-skia";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";
import { Inter_700Bold } from "@expo-google-fonts/inter/700Bold";

/**
 * Metro resolves the `.ttf` behind these named exports into an asset reference —
 * a number — which is what `useFont` wants on native. The named import is used
 * rather than a bare `require` of the file: this package is `"type": "module"`
 * and declares no `@types/node`, so `require` would typecheck only by reaching
 * for a hoisted type package it never declared. The export is typed `number`,
 * which is exactly Skia's `RNModule` arm of `DataSource`.
 *
 * Returns null until the font resolves — callers must render without text
 * rather than blocking, because a canvas that waits for a font shows nothing
 * at all on a slow connection.
 *
 * Bold is a separate file rather than a style flag. Skia draws the glyphs a
 * font contains and offers no synthetic emboldening, so a weight that is not
 * loaded is a weight that cannot be drawn.
 */
export function useBoardFont(size: number, bold = false): SkFont | null {
  return useFont(bold ? Inter_700Bold : Inter_400Regular, size);
}
