import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import {
  generateKnownNames,
  OUTPUT,
} from "../scripts/generate-known-names";

test("src/known-names.ts is up to date, run `bun run generate` otherwise", () => {
  expect(readFileSync(OUTPUT, "utf8")).toBe(generateKnownNames());
});
