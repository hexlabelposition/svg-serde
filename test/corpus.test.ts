import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { describe, expect, test } from "vitest";
import { parse, stringify } from "../src/index";
import { checkPositions } from "./positions";

/**
 * Directories of real-world SVG files. Icon sets come from devDependencies;
 * `fixtures` holds editor exports and selected SVGO regression inputs.
 */
const corpora = {
  "simple-icons": "../node_modules/simple-icons/icons",
  "bootstrap-icons": "../node_modules/bootstrap-icons/icons",
  "tabler-icons": "../node_modules/@tabler/icons/icons",
};

const fixtureCorpora = ["inkscape", "illustrator", "figma", "svgo"];

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

  const pretty = stringify(document, { pretty: true });
  if (stringify(parse(pretty), { pretty: true }) !== pretty) {
    return "pretty stringify output is not stable";
  }

  const trimmed = parse(source, { whitespace: "trim" });
  if (stringify(trimmed, { pretty: true }) !== pretty) {
    return 'whitespace: "trim" changes more than formatting whitespace';
  }

  const positioned = parse(source, { positions: true });
  const positionError = checkPositions(source, positioned);
  if (positionError !== undefined) {
    return `wrong positions: ${positionError}`;
  }
  return undefined;
}

describe("corpus", () => {
  test.each(Object.entries(corpora))("%s", (_name, relativePath) => {
    const files = listSvgFiles(join(import.meta.dirname, relativePath));
    const failures: string[] = [];

    // Guards against a moved icon directory silently passing with no files.
    expect(files.length).toBeGreaterThan(100);

    for (const file of files) {
      const reason = check(readFileSync(file, "utf8"));
      if (reason !== undefined) {
        failures.push(`${file}: ${reason}`);
      }
    }

    expect(failures).toEqual([]);
  });

  describe.each(fixtureCorpora)("%s fixtures", (name) => {
    const directory = join(import.meta.dirname, "fixtures", name);
    const files = listSvgFiles(directory);

    test("contains SVG files", () => {
      expect(files.length).toBeGreaterThan(0);
    });

    test.each(
      files.map((file) => [file.slice(directory.length + 1), file] as const),
    )("%s round-trips with stable compact and pretty output", (_name, file) => {
      expect(check(readFileSync(file, "utf8"))).toBeUndefined();
    });
  });
});
