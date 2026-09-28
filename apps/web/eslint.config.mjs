import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // The React Compiler's rules. They flag what the compiler cannot optimise —
    // a ref read or written during render, state set from an effect — which the
    // gesture overlays do deliberately, and this app does not run through the
    // compiler. Reported rather than failing the build, so every instance is in
    // view on the day the compiler is adopted.
    rules: {
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // Test harnesses hand hook state to the test by writing it onto a probe
    // object during render, and pass render-prop children as props — both are
    // what a harness is for.
    files: ["test/**"],
    rules: {
      "react-hooks/immutability": "off",
      "react/no-children-prop": "off",
    },
  },
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Node scripts and bundler stubs, not application code.
    "copy-assets.js",
    "stubs/**",
  ]),
]);

export default eslintConfig;
