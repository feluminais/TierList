import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import { lazy, Suspense, useEffect, useState } from "react";
import { ActivityIndicator, Platform, View } from "react-native";

/**
 * The route, and nothing else.
 *
 * `../src/Editor` is loaded lazily on *both* platforms, and that is the whole
 * point of this file. `@shopify/react-native-skia`'s web entry builds its API
 * object when the module loads:
 *
 *     export const Skia = JsiSkApi(global.CanvasKit);
 *
 * so anything that reaches `@tl/editor` — which `Editor` does — must not be
 * evaluated until CanvasKit is on the global. A static import here would be
 * evaluated as soon as the router's bundle starts, before any of that, and
 * every Skia call would then read off `undefined`. `WithSkiaWeb` loads
 * CanvasKit first and imports the component after, in that order; `apps/web`'s
 * `SkiaHost` does the same thing by hand for the same reason.
 *
 * On native there is nothing to load — Skia is linked in — so the same lazy
 * import is used without the wrapper, which would only warn.
 */
const Editor = lazy(() => import("../src/Editor"));

function Loading() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0b0d10" }}>
      <ActivityIndicator color="#8b98a6" />
    </View>
  );
}

export default function Route() {
  // Nothing Skia-related may run during the static export's server render:
  // `WithSkiaWeb` sees `Platform.OS === "web"` there too, and tries to fetch
  // `/canvaskit.wasm` through Node, which resolves it as a *filesystem* path
  // and aborts the whole build. Waiting for a mount is what keeps the
  // prerendered HTML to the spinner below and moves the load into the browser,
  // where the URL means what it says.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <Loading />;

  if (Platform.OS === "web") {
    return (
      <WithSkiaWeb
        getComponent={() => import("../src/Editor")}
        fallback={<Loading />}
        // CanvasKit derives its own WASM URL from a module URL the bundler
        // rewrites; naming the path explicitly is what stops the 404.
        opts={{ locateFile: (file: string) => `/${file}` }}
      />
    );
  }
  return (
    <Suspense fallback={<Loading />}>
      <Editor />
    </Suspense>
  );
}
