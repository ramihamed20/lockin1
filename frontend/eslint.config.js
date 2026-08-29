import jsxA11y from "eslint-plugin-jsx-a11y";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["dist/**", "dev-dist/**", "node_modules/**"]
  },
  {
    files: ["vite.config.js", "src/**/*.{js,jsx}", "tests/**/*.js"],
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true }
      },
      globals: {
        AbortSignal: "readonly",
        Blob: "readonly",
        File: "readonly",
        cancelAnimationFrame: "readonly",
        clearTimeout: "readonly",
        console: "readonly",
        FormData: "readonly",
        Headers: "readonly",
        HTMLElement: "readonly",
        Event: "readonly",
        Intl: "readonly",
        Notification: "readonly",
        Response: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        caches: "readonly",
        document: "readonly",
        fetch: "readonly",
        localStorage: "readonly",
        navigator: "readonly",
        process: "readonly",
        requestAnimationFrame: "readonly",
        self: "readonly",
        window: "readonly"
      }
    },
    settings: {
      react: { version: "18.3" }
    },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs["jsx-runtime"].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      "no-undef": "error",
      "react/prop-types": "off",
      "react/no-unescaped-entities": "off",
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error"
    }
  },
  {
    files: ["vite.config.js", "src/**/*.{js,jsx}", "tests/**/*.js"],
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }]
    }
  }
];
