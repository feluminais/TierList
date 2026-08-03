import { useFont } from "@shopify/react-native-skia";
import type { SkFont } from "@shopify/react-native-skia";

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
