// @ts-check
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  {
    ignores: [
      "node_modules/**",
      "dist/**",
      "out/**",
      "out-test/**",
      ".vscode-test/**",
    ],
  },
  ...tsPlugin.configs["flat/recommended"],
  {
    // Build config files are plain CommonJS, not part of the extension's
    // TypeScript source - `require()` there is correct, not a mistake.
    files: ["*.config.js"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];
