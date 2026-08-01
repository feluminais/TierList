/**
 * Compile-time guard for the "no DOM" boundary. Not a Vitest file -- there is
 * nothing to run, and the `.ts` (not `.test.ts`) name keeps it out of the test
 * run while `include: ["src", "test"]` still typechecks it.
 *
 * `@ts-expect-error` inverts the usual polarity: it fails when the next line
 * *succeeds*. If DOM ever leaks back into this package these stop being
 * errors, the directives become unused, and `tsc` fails with TS2578
 * "Unused '@ts-expect-error' directive" -- turning a silent regression into a
 * red `pnpm typecheck` instead of something only a hand-run experiment finds.
 *
 * Both kinds of leak are covered because they arrive by different routes and
 * a single assertion would miss one:
 *
 *   types  DOM interfaces (HTMLCanvasElement, HTMLElement) come back via
 *          @types/react/global.d.ts, reachable through the base config's
 *          jsx: "react-jsx" injection or through automatic @types inclusion
 *          under nodeLinker: hoisted. Blocked by jsx: "preserve" + types: [].
 *
 *   values DOM globals (document, window) come from lib.dom.d.ts. Blocked by
 *          omitting "DOM" from lib.
 *
 * Verified by regression: removing types: [], removing jsx: "preserve", or
 * adding "DOM" back to lib each makes this file fail to compile.
 */

// @ts-expect-error DOM interfaces must not resolve in this package.
type _NoCanvas = HTMLCanvasElement;
// @ts-expect-error DOM interfaces must not resolve in this package.
type _NoElement = HTMLElement;
// @ts-expect-error DOM globals must not resolve in this package.
type _NoDocument = typeof document;
// @ts-expect-error DOM globals must not resolve in this package.
type _NoWindow = typeof window;
