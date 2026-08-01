import { useFont } from "@shopify/react-native-skia";
import type { SkFont } from "@shopify/react-native-skia";
import { Inter_400Regular } from "@expo-google-fonts/inter/400Regular";

/**
 * Metro resolves the `.ttf` behind this named export into an asset reference —
 * a number — which is what `useFont` wants on native. The named import is used
 * rather than a bare `require` of the file: this package is `"type": "module"`
 * and declares no `@types/node`, so `require` would typecheck only by reaching
 * for a hoisted type package it never declared. The export is typed `number`,
 * which is exactly Skia's `RNModule` arm of `DataSource`.
 *
 * Returns null until the font resolves — callers must render without text
 * rather than blocking, because a canvas that waits for a font shows nothing
 * at all on a slow connection.
 */
export function useBoardFont(size: number): SkFont | null {
  return useFont(Inter_400Regular, size);
}
