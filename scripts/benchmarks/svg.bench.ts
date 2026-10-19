import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { arch, cpus, platform, release } from "node:os";
import * as svgParser from "svg-parser";
import * as svgson from "svgson";
import { describe, test } from "vitest";
import * as serde from "../../dist/index.js";

// Bind functions once, outside timing loops, including Vitest module getters.
const { parse: parseSerde, stringify: stringifySerde } = serde;
const { parseSync: parseSvgson, stringify: stringifySvgson } = svgson;
const { parse: parseSvgParser } = svgParser;

const require = createRequire(import.meta.url);
const time = Number(process.env.BENCH_TIME_MS ?? 500);
if (!Number.isSafeInteger(time) || time <= 0) {
  throw new RangeError("BENCH_TIME_MS must be a positive safe integer");
}

const options = {
  time,
  iterations: 20,
  warmupTime: 250,
  warmupIterations: 5,
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function version(name: string): string {
  const manifest = JSON.parse(
    readFileSync(require.resolve(`${name}/package.json`), "utf8"),
  ) as { version: string };
  return manifest.version;
}

const environment = {
  runtime:
    process.versions.bun === undefined
      ? { name: "node", version: process.version }
      : { name: "bun", version: process.versions.bun },
  platform: platform(),
  release: release(),
  arch: arch(),
  cpu: cpus()[0]?.model ?? "unknown",
  packages: {
    "svg-serde": version("svg-serde"),
    svgson: version("svgson"),
    "svg-parser": version("svg-parser"),
    vitest: version("vitest"),
  },
  buildSha256: hash(
    readFileSync(new URL("../../dist/index.js", import.meta.url), "utf8"),
  ),
};

function fixture(path: string): string {
  return readFileSync(
    new URL(`../../test/fixtures/${path}`, import.meta.url),
    "utf8",
  );
}

function rectangles(count: number): string {
  const children = Array.from(
    { length: count },
    (_, index) =>
      `<g id="item-${index}" transform="translate(${index % 100} ${Math.floor(index / 100)})"><rect width="8" height="8" fill="#336699"/></g>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${children.join("")}</svg>`;
}

const inputs = [
  { name: "figma/wallet", source: fixture("figma/wallet.svg") },
  {
    name: "inkscape/emblem-pause",
    source: fixture("inkscape/emblem-pause.svg"),
  },
  {
    name: "illustrator/circle-and-text",
    source: fixture("illustrator/circle-and-text.svg"),
  },
  { name: "generated/1000-rectangles", source: rectangles(1_000) },
  { name: "generated/10000-rectangles", source: rectangles(10_000) },
  {
    name: "generated/large-path",
    source: `<svg xmlns="http://www.w3.org/2000/svg"><path d="${"M0 0 L1 1 L2 0 Z ".repeat(65_536)}"/></svg>`,
  },
];

console.log("Benchmark environment:", JSON.stringify(environment));
console.log("Sampling options:", JSON.stringify(options));

for (const { name, source } of inputs) {
  const input = {
    name,
    bytes: Buffer.byteLength(source),
    sha256: hash(source),
  };

  // Read/generate inputs, prepare trees, and check the build before timing.
  const serdeTree = parseSerde(source);
  const svgsonTree = parseSvgson(source);
  assert.deepStrictEqual(parseSerde(stringifySerde(serdeTree)), serdeTree);
  assert.equal(parseSvgParser(source).children[0].type, "element");
  parseSerde(stringifySvgson(svgsonTree));

  describe(`${name} (${input.bytes} bytes)`, () => {
    test("parse", async ({ bench, task }) => {
      Object.assign(task.meta, { environment, input, options });
      await bench.compare(
        bench("svg-serde", () => parseSerde(source)),
        bench("svgson", () => parseSvgson(source)),
        bench("svg-parser", () => parseSvgParser(source)),
        options,
      );
    });

    test("stringify", async ({ bench, task }) => {
      Object.assign(task.meta, { environment, input, options });
      await bench.compare(
        bench("svg-serde", () => stringifySerde(serdeTree)),
        bench("svgson", () => stringifySvgson(svgsonTree)),
        options,
      );
    });

    test("round-trip", async ({ bench, task }) => {
      Object.assign(task.meta, { environment, input, options });
      await bench.compare(
        bench("svg-serde", () => stringifySerde(parseSerde(source))),
        bench("svgson", () => stringifySvgson(parseSvgson(source))),
        options,
      );
    });
  });
}
