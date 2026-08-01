// Deliberately throws on evaluation.
//
// @shopify/react-native-skia's ReanimatedProxy does a try/catch require() of
// react-native-reanimated and falls back to an "optional dependency not
// installed" path when it throws. Before apps/mobile existed, reanimated was
// never installed and that fallback was taken for free.
//
// apps/mobile brings reanimated in as a real package, and Turbopack follows
// the require statically - a runtime try/catch does not prune a static import
// graph - dragging reanimated and then raw React Native Flow source into the
// browser bundle.
//
// Aliasing to this module makes the require throw again, so Skia takes the
// same fallback path it always did. The web build never needed reanimated;
// it only appeared to work because the package was absent.
throw new Error("react-native-reanimated is not available in the web build");
