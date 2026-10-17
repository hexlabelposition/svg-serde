import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, test } from "vitest";
import { parse, stringify } from "../src/index";

/**
 * Directories of real-world SVG files. Icon sets come from devDependencies;
 * `fixtures` holds files exported from editors.
 */
const corpora = {
  "simple-icons": "../node_modules/simple-icons/icons",
  "bootstrap-icons": "../node_modules/bootstrap-icons/icons",
  "tabler-icons": "../node_modules/@tabler/icons/icons",
  fixtures: "fixtures",
};

function listSvgFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".svg"))
    .sort()
    .map((file) => join(directory, file));
}

/**
 * Returns why a file fails the corpus checks, or `undefined` if it passes.
 */
function check(source: string): string | undefined {
  let document;
  try {
    document = parse(source);
  } catch (error) {
    return `parse failed: ${String(error)}`;
  }

  const output = stringify(document);
  if (!isDeepStrictEqual(parse(output), document)) {
    return "parse(stringify(document)) differs from document";
  }
  if (stringify(parse(output)) !== output) {
    return "stringify output is not stable";
  }
  return undefined;
}

describe("corpus", () => {
  test.each(Object.entries(corpora))("%s", (name, relativePath) => {
    const files = listSvgFiles(join(import.meta.dirname, relativePath));
    const failures: string[] = [];

    // Guards against a moved icon directory silently passing with no files.
    if (name !== "fixtures") {
      expect(files.length).toBeGreaterThan(100);
    }

    for (const file of files) {
      const reason = check(readFileSync(file, "utf8"));
      if (reason !== undefined) {
        failures.push(`${file}: ${reason}`);
      }
    }

    expect(failures).toEqual([]);
  });
});
