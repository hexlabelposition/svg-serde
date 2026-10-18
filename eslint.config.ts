import js from "@eslint/js";
import type { Linter } from "eslint";
import prettier from "eslint-config-prettier";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

const config: Linter.Config[] = defineConfig(
  { ignores: ["dist", "coverage"] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    rules: {
      // Numbers are formatted predictably, e.g. in error messages.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      // isolatedDeclarations requires explicit types on exports, such as
      // `RegExp` on a `new RegExp()` value.
      "@typescript-eslint/no-inferrable-types": "off",
      // Allows `while (true)` loops.
      "@typescript-eslint/no-unnecessary-condition": [
        "error",
        { allowConstantLoopConditions: "only-allowed-literals" },
      ],
    },
  },
  {
    languageOptions: {
      parserOptions: {
        // Uses the nearest tsconfig.json, so test and scripts get Node.js types.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Formatting is left to Prettier.
  prettier,
);

export default config;
