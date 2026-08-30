import js from "@eslint/js";

export default [
  js.configs.recommended,
  {
    ignores: ["static/three.module.min.js"],
  },
  {
    files: ["static/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-control-regex": "off",
      "no-unsafe-finally": "off",
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  {
    files: ["static/home-entry.js", "static/essence_visualizer.js"],
    languageOptions: {
      sourceType: "module",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
