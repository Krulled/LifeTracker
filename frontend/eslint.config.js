import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default [
  { ignores: ["dist"] },
  {
    files: ["**/*.{js,jsx}"],
    ...js.configs.recommended,
    plugins: {
      "react-hooks":    reactHooks,
      "react-refresh":  reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": "warn",
      "no-unused-vars": ["warn", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
      "no-console":     "warn",
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType:  "module",
      globals: { window: true, document: true, console: true, fetch: true },
    },
  },
];
