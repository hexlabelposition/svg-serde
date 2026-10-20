# svg-serde

[![npm version](https://img.shields.io/npm/v/svg-serde)](https://www.npmjs.com/package/svg-serde)
[![CI](https://github.com/hexlabelposition/svg-serde/actions/workflows/ci.yml/badge.svg)](https://github.com/hexlabelposition/svg-serde/actions/workflows/ci.yml)
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

Compared with similar libraries, `svg-serde` focuses on strict XML parsing, safe handling of untrusted input, and lossless preservation of every supported XML construct. See [Comparison with alternatives](#comparison-with-alternatives).

## Goals

- **Bidirectional conversion.** Parse SVG markup and serialize an object tree back to SVG.
- **Predictable round trips.** Preserve meaningful SVG content, including element order, text, comments, namespaces, and unknown elements or attributes.
- **TypeScript-first API.** Provide helpful types without restricting custom SVG extensions.
- **Plain JavaScript objects.** Keep the public representation independent of browser DOM nodes.
- **Cross-runtime support.** Target Node.js, Bun, and modern browsers.
- **Small, focused API.** Keep parsing and serialization simple and avoid unrelated SVG processing features.
- **No implicit interpretation.** Keep attribute values as strings, without evaluating CSS, units, or transforms.
- **Strict, standards-compliant parsing.** Accept only well-formed XML and report every error with a stable code and position.
- **No runtime dependencies.** Include a strict XML parser built for this library, so installs stay small and behavior is fully under the project's control.

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
import { parse, stringify, getRoot } from "svg-serde";

const document = parse(`
  <svg xmlns="http://www.w3.org/2000/svg">
    <rect width="100" height="100" fill="red" />
  </svg>
`);

const svg = getRoot(document);
const rect = svg.children.find(
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
stringify(parse("<svg><g><rect/><circle/></g></svg>"), { pretty: true });
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

### Remove formatting whitespace

By default, `parse()` keeps every text node, including line breaks and indentation between elements. Pass `whitespace: "trim"` to drop that whitespace and get a tree with only meaningful nodes:

```ts
const svg = `
<svg>
  <g>
    <rect/>
  </g>
</svg>`;

parse(svg, { whitespace: "trim" });
// The same tree as parse("<svg><g><rect/></g></svg>")
```

It removes exactly the whitespace that `pretty` replaces, by the same rules, so text and the content of the elements listed above stay unchanged.

## Examples

The tree is plain data, so changes are ordinary JavaScript: assign or `delete` attributes, and add, remove, or reorder `children`. A small generator makes it easy to visit every element:

```ts
import type { SvgDocument, SvgElement, SvgNode } from "svg-serde";

function* elements(node: SvgDocument | SvgNode): Generator<SvgElement> {
  if (node.type === "element") {
    yield node;
  }
  if (node.type === "element" || node.type === "document") {
    for (const child of node.children) {
      if (child.type === "element") {
        yield* elements(child);
      }
    }
  }
}
```

### Recolor an icon

```ts
const document = parse(svg);

for (const element of elements(document)) {
  if (element.attributes.fill === "#000") {
    element.attributes.fill = "currentColor";
  }
}

stringify(document);
```

### Remove comments and editor metadata

```ts
const isEditorName = (name: string) =>
  /^(xmlns:)?(inkscape|sodipodi)(:|$)/.test(name);

for (const element of elements(document)) {
  element.children = element.children.filter(
    (child) =>
      child.type !== "comment" &&
      !(child.type === "element" && isEditorName(child.name)),
  );
  for (const name of Object.keys(element.attributes)) {
    if (isEditorName(name)) {
      delete element.attributes[name];
    }
  }
}
```

The generator visits children after their parent, so removed elements are never visited.

### Add an accessible title

```ts
const svg = getRoot(document);

svg.attributes.role = "img";
svg.children.unshift({
  type: "element",
  name: "title",
  attributes: {},
  children: [{ type: "text", value: "Home & garden" }],
});

stringify(document);
// <svg role="img"><title>Home &amp; garden</title>...</svg>
```

Text and attribute values are stored unescaped; `stringify()` escapes them.

### Build a document from scratch

```ts
import { stringify, type SvgDocument } from "svg-serde";

const document: SvgDocument = {
  type: "document",
  children: [
    {
      type: "element",
      name: "svg",
      attributes: { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 10 10" },
      children: [
        {
          type: "element",
          name: "circle",
          attributes: { cx: "5", cy: "5", r: "4" },
          children: [],
        },
      ],
    },
  ],
};

stringify(document, { pretty: true });
```

## Object model

`parse()` returns an `SvgDocument`. Its `children` contain exactly one root element, plus any comments, processing instructions, DOCTYPE, and whitespace outside it.

Use `getRoot(document)` to access that element:

```ts
import { parse, getRoot } from "svg-serde";

const document = parse('<svg viewBox="0 0 24 24"/>');
const root = getRoot(document); // SvgElement
root.attributes.fill = "currentColor";
```

`getRoot()` returns the original element, so editing it changes the document. It throws a `TypeError` if a manually created or edited document has zero or multiple root elements. Like `parse()`, it accepts any root element name.

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
  name: SvgElementName; // as written, including prefixes: "svg", "sodipodi:namedview"
  attributes: SvgAttributes; // in source order, keys like "fill" or "xlink:href"
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

The tree is plain data: no classes, no cycles, no parent references, and no `undefined` values. It can be stored as JSON, copied with `structuredClone()`, or sent to a worker as is.

Names are stored as written, including namespace prefixes, and namespace declarations such as `xmlns` and `xmlns:xlink` are ordinary attributes.

Attribute values are intentionally represented as strings:

```xml
<rect width="50%" opacity="0.5" x="10" />
```

The parser does not convert `"10"` into `10`, evaluate percentages, or interpret CSS expressions. Those behaviors belong to higher-level SVG tooling.

### Source positions

Pass `positions: true` to add the source range of every node, for example to highlight an element in a code editor or to report problems found in the tree:

```ts
const svg = '<svg>\n  <rect width="10"/>\n</svg>';
const [, rect] = getRoot(parse(svg, { positions: true })).children;

if (rect?.position) {
  rect.position;
  // {
  //   start: { line: 2, column: 3, offset: 8 },
  //   end: { line: 2, column: 21, offset: 26 },
  // }

  svg.slice(rect.position.start.offset, rect.position.end.offset);
  // '<rect width="10"/>'
}
```

`line` and `column` are 1-based and `offset` is 0-based, the same as in `SvgParseError`. Columns and offsets count UTF-16 code units, like JavaScript string indexes, and `end` points to the character after the node. An element range covers everything from its start tag to its end tag, and a text range covers the text as written, before references are decoded.

Positions are added only on request, so trees stay small by default. `stringify()` ignores them, and they are not updated when the tree changes.

## Round-trip behavior

For every document returned by `parse()`, serializing and parsing again produces an equal tree:

```ts
const first = parse(svg);
const second = parse(stringify(first));

// first and second are deeply equal
```

With `pretty: true`, the same holds once whitespace-only text between elements is ignored:

```ts
const formatted = stringify(parse(svg), { pretty: true });

// parse(formatted, { whitespace: "trim" }) and
// parse(svg, { whitespace: "trim" }) are deeply equal
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

`stringify()` throws a `TypeError` for a tree that cannot be written as well-formed XML: an invalid name or character, an attribute value that is not a string, a comment containing `--`, a processing instruction containing `?>`, or a document without exactly one root element. Such trees can only come from code that builds or edits the tree, never from `parse()`.

## Runtime support

`svg-serde` is an ESM-only package with TypeScript declarations. It targets:

- Node.js 22 or later
- Bun 1.2 or later
- Browsers that support ES2022

CI runs the test suite on Node.js 22, 24, and 26, on Bun 1.2.23 and the latest Bun release, and in Chromium, Firefox, and WebKit.

The package has no runtime dependencies: it includes its own strict XML parser.

## Safety

The parser is designed to handle untrusted input:

- External entities and external DTDs are never loaded.
- Entities declared in the DOCTYPE are expanded with limits that stop expansion attacks such as "billion laughs".
- Input length and element nesting depth are limited.

All limits have defaults, chosen by measuring real-world files:

| Option                | Default             | Measured maximum                                |
| --------------------- | ------------------- | ----------------------------------------------- |
| `maxInputLength`      | 67,108,864 (64 MiB) | 90.8M characters; 99.9% of files are below 3.2M |
| `maxDepth`            | 1,024               | 13 levels                                       |
| `maxEntityExpansions` | 10,000              | 7 references                                    |
| `maxExpandedLength`   | 1,048,576 (1 MiB)   | 242 characters                                  |

The measurements cover 16,904 files: icon sets, KDE Oxygen icons exported from Inkscape and Adobe Illustrator, the W3C SVG 1.1 test suite, and large maps from Wikimedia Commons. Only one map exceeds a default limit. Lower the limits for tighter resource budgets, or raise `maxInputLength` for very large trusted files:

```ts
parse(svg, {
  maxInputLength: 1_000_000,
  maxDepth: 256,
});
```

Parsing SVG into an object tree does **not** make arbitrary SVG safe to render in a browser. Applications that display untrusted SVG must apply an appropriate sanitization policy.

## Limitations

- **Lexical details are not preserved.** Quote style, entity spelling, and whitespace inside tags are normalized, as described in [Round-trip behavior](#round-trip-behavior).
- **Entities with markup are not supported.** An entity whose replacement text contains elements, such as `<!ENTITY shape "<path/>">`, makes `parse()` throw an `UNSUPPORTED_ENTITY` error. Text entities, which Adobe Illustrator uses, are expanded.
- **The DTD is not interpreted.** Parameter entities are not expanded, and default attribute values from `<!ATTLIST>` are not applied.
- **Namespace URIs are not resolved.** Names keep the prefixes as written; only undeclared prefixes are rejected.
- **Only XML syntax is accepted.** SVG embedded in HTML, which follows HTML parsing rules, has to be extracted as well-formed XML first.

## Comparison with alternatives

[svgson](https://github.com/elrumordelaluz/svgson) and [svg-parser](https://github.com/Rich-Harris/svg-parser) also turn SVG into JavaScript objects. The table shows how they handled the same inputs in svgson 5.3.1 and svg-parser 2.1.0:

|                                                | svg-serde                              | svgson                                 | svg-parser                                            |
| ---------------------------------------------- | -------------------------------------- | -------------------------------------- | ----------------------------------------------------- |
| Serialization                                  | `stringify()`                          | `stringify()`                          | Parsing only                                          |
| Malformed input, such as `<svg><g></svg>`      | `SvgParseError` with code and position | Unrelated `TypeError`                  | Error for mismatched tags; unclosed tags are accepted |
| Comments, processing instructions              | Kept as nodes                          | Dropped                                | Dropped; prolog kept as a string                      |
| Entity references (`&amp;`, `&#169;`)          | Decoded                                | Kept as written                        | Kept as written                                       |
| Escaped text and attributes after a round trip | Unchanged                              | Changed: `&quot;` becomes `&amp;quot;` | —                                                     |
| Entities declared in the DOCTYPE               | Expanded with limits                   | Not expanded                           | Not expanded                                          |
| Attribute values                               | Strings                                | Strings                                | Numeric strings become numbers                        |

svgson can also transform nodes while parsing, and svg-parser produces a [hast](https://github.com/syntax-tree/hast)-like tree. Choose svg-serde when the tree has to be written back without losing or changing data.

## Benchmarks

Run `bun run bench` for Node.js or `bun run bench:bun` for Bun. The suite measures parsing, serialization, and full round trips using the built package, with comparisons against `svgson` and `svg-parser` where supported.

See the [benchmark guide](./scripts/benchmarks/README.md) for inputs, sampling settings, JSON reports, and comparison limitations. Claims about speed or package size in this project are backed by these reproducible measurements.

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
- Script execution and loading external resources, such as images or stylesheets

These tasks can be handled by separate libraries without making `svg-serde` depend on them.

## Versioning

`svg-serde` follows [semantic versioning](https://semver.org/). Until version 1.0, the object model may still change:

- **0.x minor releases** (0.2 to 0.3) may contain breaking changes, which the release notes list.
- **0.x patch releases** (0.2.0 to 0.2.1) contain only fixes and compatible additions.

From version 1.0, breaking changes require a major release. This includes adding a node type, because it breaks exhaustive `switch` statements over `node.type`. Raising the minimum supported runtime versions is also a breaking change.

Release notes are published on [GitHub Releases](https://github.com/hexlabelposition/svg-serde/releases).

## Project status

`parse()` and `stringify()` are implemented and tested with unit tests, property-based tests, and more than 11,000 real-world icons. The checked-in [SVG corpus](./test/fixtures/README.md) also covers Inkscape, Adobe Illustrator, and Figma exports, plus selected SVGO regression inputs.

Ideas for new features are discussed in [GitHub Issues](https://github.com/hexlabelposition/svg-serde/issues).

## Contributing

Feedback, bug reports, and design discussions are welcome through [GitHub Issues](https://github.com/hexlabelposition/svg-serde/issues). See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development setup, conventions, and the release process.

## License

[MIT](./LICENSE)
