# mobile

The Expo app. It renders `@tl/editor`'s board inside a scroll container, which is where edge
autoscroll during a drag is exercised. The chrome, uploads and the edit sheet are web-only.

## Running it

```bash
pnpm --filter mobile start
```

`android/` is gitignored build output under Continuous Native Generation. Regenerate it with:

```bash
pnpm --filter mobile exec expo prebuild --clean
```

Do that after any change to `app.json`, a config plugin, or the workspace's `nodeLinker`.
Autolinking writes absolute dependency paths into the native project, so a stale one builds
against the previous layout.

A command-line Gradle build needs `ANDROID_HOME` set; Android Studio supplies its own.

## Constraints

- `nodeLinker: hoisted` in `pnpm-workspace.yaml` is required by the native build.
- The workspace pins `react`, `react-dom`, `react-native` and `@shopify/react-native-skia` to the
  versions this SDK expects. Keep `package.json` here in step when bumping the SDK.
- `com.anonymous.mobile` is a placeholder package name. It has to change before any store
  submission, and changing it afterwards breaks in-place upgrades.
