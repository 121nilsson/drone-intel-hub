import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      // Lovable-generated integration glue, marked "automatically generated — do not edit".
      // Editing it by hand gets overwritten on the next generation round, so lint findings
      // there are not actionable: exclude the area instead (same policy as routeTree.gen.ts
      // in .prettierignore).
      "src/integrations",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
  {
    // Formatting drift is a warning, not an error. The codebase is largely generated and
    // maintained through tooling (Lovable/Bun) that does not run prettier, so hard errors
    // would block lint on hundreds of unrelated formatting violations and make the lint
    // signal useless. CI reports drift separately (and advisory) via `prettier --check .`.
    // To make formatting blocking again, run `npx prettier --write .` once, commit, and
    // remove this override.
    rules: { "prettier/prettier": "warn" },
  },
);
