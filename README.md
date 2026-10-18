# svg-serde

[![npm version](https://img.shields.io/npm/v/svg-serde)](https://www.npmjs.com/package/svg-serde)
[![Release](https://github.com/hexlabelposition/svg-serde/actions/workflows/release.yml/badge.svg)](https://github.com/hexlabelposition/svg-serde/actions/workflows/release.yml)
[![Types](https://img.shields.io/npm/types/svg-serde)](https://www.npmjs.com/package/svg-serde)
[![License](https://img.shields.io/npm/l/svg-serde)](./LICENSE)

**Parse SVG into plain JavaScript objects and serialize them back to SVG.**

`svg-serde` is a TypeScript-first library for working with SVG as structured data. It is designed for SVG editors, icon generators, asset pipelines, and tools that need to inspect, modify, or generate SVG without tying their data model to the browser DOM.

```text
SVG markup <-> JavaScript object tree
```

> [!NOTE]
> **Early development.** Until version 1.0, the API and the object model may change in minor releases.

## Why svg-serde?

Working with SVG often means working with XML strings or browser DOM nodes. `svg-serde` provides a small alternative: parse markup into ordinary JavaScript objects, make changes using familiar language features, and serialize the result back into SVG.

The library focuses on one responsibility: **conversion between SVG markup and a structured object representation**. It does not attempt to be an editor, renderer, geometry toolkit, or SVG optimizer.

## Goals

- **Bidirectional conversion.** Parse SVG markup and serialize an object tree back to SVG.
- **Predictable round trips.** Preserve meaningful SVG content, including element order, text, comments, namespaces, and unknown elements or attributes.
- **TypeScript-first API.** Provide helpful types without restricting custom SVG extensions.
- **Plain JavaScript objects.** Keep the public representation independent of browser DOM nodes.
- **Cross-runtime support.** Target Node.js, Bun, and modern browsers.
- **Small, focused API.** Keep parsing and serialization simple and avoid unrelated SVG processing features.

## Installation

```bash
npm install svg-serde
```

Or with another package manager:

```bash
pnpm add svg-serde
# or
bun add svg-serde
```

## Quick start

### Parse SVG

```ts
import { parse } from "svg-serde";

const document = parse(`
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="40" fill="red" />
  </svg>
`);
```

`document` is a plain object:

```ts
{
  type: "document",
  children: [
    { type: "text", value: "\n  " },
    {
      type: "element",
      name: "svg",
      attributes: { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 100 100" },
      children: [
        { type: "text", value: "\n    " },
        {
          type: "element",
          name: "circle",
          attributes: { cx: "50", cy: "50", r: "40", fill: "red" },
          children: [],
        },
        { type: "text", value: "\n  " },
      ],
    },
    { type: "text", value: "\n" },
  ],
}
```

### Modify and serialize

```ts
import { parse, stringify } from "svg-serde";

const document = parse(`
  <svg xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" fill="red" />
  </svg>
`);

const svg = document.children.find((node) => node.type === "element");
const rect = svg?.children.find(
  (node) => node.type === "element" && node.name === "rect",
);

if (rect?.type === "element") {
  rect.attributes.fill = "blue";
}

const result = stringify(document);
```

### Format output

By default, `stringify()` writes compact output that keeps all whitespace as parsed. Pass `pretty` to put each element on its own line, indented by `indent` spaces (default `2`):

```ts
stringify(parse('<svg><g><rect/><circle/></g></svg>'), { pretty: true });
```

```xml
<svg>
  <g>
    <rect/>
    <circle/>
  </g>
</svg>
```

Formatting only replaces whitespace between elements; text is never changed. Content stays exactly as stored, including nested elements, inside:

- elements that contain text or CDATA, such as `<p>Hello <b>world</b></p>` in a `<foreignObject>`
- `<text>`, `<tspan>`, `<textPath>`, `<style>`, `<script>`, `<title>`, and `<desc>`
- elements with `xml:space="preserve"`

## Object model

`parse()` returns an `SvgDocument`. Its `children` contain exactly one root element, plus any comments, processing instructions, DOCTYPE, and whitespace outside it.

```ts
interface SvgDocument {
  type: "document";
  declaration?: {
    version: string;
    encoding?: string;
    standalone?: "yes" | "no";
  };
  children: SvgDocumentChild[];
}

interface SvgElement {
  type: "element";
  name: string; // as written, including prefixes: "svg", "xlink:href", "inkscape:label"
  attributes: Record<string, string>; // in source order
  children: SvgNode[];
}

type SvgNode =
  | SvgElement
  | { type: "text"; value: string }
  | { type: "cdata"; value: string }
  | { type: "comment"; value: string }
  | { type: "instruction"; target: string; value: string };

type SvgDocumentChild =
  | SvgElement
  | { type: "text"; value: string }
  | { type: "comment"; value: string }
  | { type: "instruction"; target: string; value: string }
  | { type: "doctype"; value: string };
```

The tree is JSON-safe: no classes, no cycles, and no parent references.

Attribute values are intentionally represented as strings:

```xml
<rect width="50%" opacity="0.5" x="10" />
```

The parser does not convert `"10"` into `10`, evaluate percentages, or interpret CSS expressions. Those behaviors belong to higher-level SVG tooling.

## Round-trip behavior

For every document returned by `parse()`, serializing and parsing again produces an equal tree:

```ts
const first = parse(svg);
const second = parse(stringify(first));

// first and second are deeply equal
```

This does **not** mean byte-for-byte reproduction of the original source. `stringify()` normalizes lexical details that do not change the data:

- Attributes always use double quotes.
- Elements without children are self-closing: `<g></g>` becomes `<g/>`.
- Character and entity references are decoded when parsing and only `&`, `<`, `>`, and `"` are escaped when serializing, along with tabs and line breaks in attribute values.
- Line breaks are normalized to `\n`, as XML requires.

## Errors

`parse()` throws an `SvgParseError` for malformed input. It has a stable `code`, such as `"MALFORMED_XML"` or `"MAX_DEPTH_EXCEEDED"`, and the `line`, `column`, and `offset` of the problem:

```ts
import { parse, SvgParseError } from "svg-serde";

try {
  parse("<svg>");
} catch (error) {
  if (error instanceof SvgParseError) {
    console.log(error.code, error.line, error.column);
  }
}
```

`stringify()` throws a `TypeError` for a tree that cannot be written as well-formed XML, such as an invalid element name or a comment containing `--`. Such trees can only come from code that builds or edits the tree.

## Runtime support

`svg-serde` is an ESM-only package with TypeScript declarations. It targets:

- Node.js 22 or later
- Bun 1.2 or later
- Browsers that support ES2022

The test suite currently runs in Node.js. Testing in Bun and browsers is planned.

## Safety

The parser is designed to handle untrusted input:

- External entities and external DTDs are never loaded.
- Entities declared in the DOCTYPE are expanded with limits that stop expansion attacks such as "billion laughs".
- Input length and element nesting depth are limited.

All limits have defaults and can be changed through `ParseOptions`:

```ts
parse(svg, {
  maxInputLength: 1_000_000,
  maxDepth: 256,
  maxEntityExpansions: 1_000,
  maxExpandedLength: 100_000,
});
```

Parsing SVG into an object tree does **not** make arbitrary SVG safe to render in a browser. Applications that display untrusted SVG must apply an appropriate sanitization policy.

## Scope

`svg-serde` handles:

- SVG parsing and serialization
- Element hierarchy and child ordering
- Attributes and namespace-qualified names
- Text, CDATA, comments, processing instructions, XML declarations, and DOCTYPE declarations
- Correct XML escaping and well-formedness checks
- Predictable errors for invalid input

The following are intentionally **out of scope**:

- SVG rendering or DOM manipulation
- Geometry, path calculations, and transform matrices
- High-level attribute editing or CSS evaluation
- SVG optimization and minification
- Editor state, selection, layers, or undo/redo

These tasks can be handled by separate libraries without making `svg-serde` depend on them.

## Project status

`parse()` and `stringify()` are implemented and tested with unit tests, property-based tests, and more than 11,000 real-world icons. Next steps include typed SVG element and attribute names, and testing in Bun and browsers.

See [BACKLOG.md](./BACKLOG.md) for planned functionality, priorities, quality criteria, and design decisions.

## Contributing

Feedback, bug reports, and design discussions are welcome through GitHub Issues. Before implementing a feature, please check the backlog and open issues to avoid overlapping work.

## License

[MIT](./LICENSE)
