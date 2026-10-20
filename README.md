# svg-serde

[![npm version](https://img.shields.io/npm/v/svg-serde)](https://www.npmjs.com/package/svg-serde)
[![CI](https://github.com/hexlabelposition/svg-serde/actions/workflows/ci.yml/badge.svg)](https://github.com/hexlabelposition/svg-serde/actions/workflows/ci.yml)
[![Types](https://img.shields.io/npm/types/svg-serde)](https://www.npmjs.com/package/svg-serde)
[![License](https://img.shields.io/npm/l/svg-serde)](./LICENSE)

**Parse SVG into plain JavaScript objects and serialize them back to SVG.**

`svg-serde` is a TypeScript-first library for working with SVG as structured data. It is designed for SVG editors, icon generators, asset pipelines, and tools that need to inspect, modify, or generate SVG without tying their data model to the browser DOM.

> [!NOTE]
> **Early development.** Until version 1.0, the API and the object model may change in minor releases.

## Why svg-serde?

Working with SVG often means working with XML strings or browser DOM nodes. `svg-serde` parses markup into ordinary JavaScript objects, lets you change them with familiar language features, and serializes the result back into SVG.

- **Lossless round trips.** Element order, text, comments, processing instructions, the XML declaration, DOCTYPE, namespaces, and unknown elements or attributes all survive parsing and serialization.
- **Strict parsing.** Only well-formed XML is accepted, and every error has a stable code and a source position.
- **Safe for untrusted input.** External entities are never loaded, and input size, nesting depth, and entity expansion are limited.
- **Plain data.** The tree has no classes, DOM nodes, or parent references, so it can be stored as JSON or sent to a worker.
- **No implicit interpretation.** Attribute values stay strings, without evaluating CSS, units, or transforms.
- **Small and portable.** No runtime dependencies, about 12 kB gzipped, and runs on Node.js, Bun, and in browsers.
- **Fast.** Parsing is 4–6× faster than svgson and 2–3× faster than svg-parser on typical files. See [Performance](#performance).

The library focuses on one responsibility: **conversion between SVG markup and a structured object representation**. The following are intentionally out of scope and can be handled by separate libraries:

- SVG rendering or DOM manipulation
- Geometry, path calculations, and transform matrices
- High-level attribute editing or CSS evaluation
- SVG optimization and minification
- Editor state, selection, layers, or undo/redo
- Script execution and loading external resources, such as images or stylesheets

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

## API

| Export                          | Description                                                                 |
| ------------------------------- | --------------------------------------------------------------------------- |
| `parse(svg, options?)`          | Parses an SVG string into an `SvgDocument`.                                 |
| `stringify(document, options?)` | Serializes an `SvgDocument` to an SVG string.                               |
| `getRoot(document)`             | Returns the root element of a document, without copying it.                 |
| `SvgParseError`                 | The error thrown by `parse()`, with `code`, `line`, `column`, and `offset`. |

### `parse(svg, options?)`

| Option                | Default               | Description                                                                            |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------- |
| `whitespace`          | `"preserve"`          | `"trim"` removes whitespace-only text between elements, by the same rules as `pretty`. |
| `positions`           | `false`               | Adds a `position` with the source range to every node.                                 |
| `maxInputLength`      | 67,108,864 characters | Longer input is rejected before parsing.                                               |
| `maxDepth`            | 1,024                 | Maximum element nesting depth.                                                         |
| `maxEntityExpansions` | 10,000                | Maximum number of entity references expanded in a document.                            |
| `maxExpandedLength`   | 1,048,576 characters  | Maximum total length of text produced by entity expansion.                             |

Throws an `SvgParseError` for malformed input or an exceeded limit, and a `RangeError` for an invalid `whitespace` option. See [Safety](#safety) for how the limits were chosen.

### `stringify(document, options?)`

| Option   | Default | Description                                                  |
| -------- | ------- | ------------------------------------------------------------ |
| `pretty` | `false` | Indents element-only content. Text content is never changed. |
| `indent` | `2`     | Spaces per indentation level when `pretty` is `true`.        |

Throws a `TypeError` for a tree that cannot be written as well-formed XML, and a `RangeError` when `indent` is not a non-negative integer. See [Errors](#errors).

### `getRoot(document)`

Returns the root element, usually `<svg>`. Editing the returned element changes the document. Throws a `TypeError` if a manually created or edited document has zero or more than one root element.

### Types

All types are exported for use with `import type`:

| Type                                                                | Describes                                                      |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `SvgDocument`                                                       | A whole document, returned by `parse()`.                       |
| `SvgElement`, `SvgElementName`, `SvgAttributes`                     | An element, its name, and its attributes.                      |
| `SvgNode`                                                           | Any node inside an element.                                    |
| `SvgDocumentChild`                                                  | Any node at the top level of a document.                       |
| `SvgText`, `SvgCData`, `SvgComment`, `SvgInstruction`, `SvgDoctype` | The individual node types.                                     |
| `XmlDeclaration`                                                    | The `<?xml ...?>` declaration.                                 |
| `SvgPosition`, `SvgSourcePoint`                                     | Source ranges added with `positions: true`.                    |
| `ParseOptions`, `StringifyOptions`                                  | Options of `parse()` and `stringify()`.                        |
| `SvgParseErrorCode`, `SvgParseErrorDetails`                         | Error codes and the data used to construct an `SvgParseError`. |

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

// Comments before and after the root element.
document.children = document.children.filter(
  (child) => child.type !== "comment",
);

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

`parse()` returns an `SvgDocument`. Its `children` contain exactly one root element, plus any comments, processing instructions, DOCTYPE, and whitespace outside it. Use `getRoot(document)` to access the root element:

```ts
import { parse, getRoot } from "svg-serde";

const document = parse('<svg viewBox="0 0 24 24"/>');
const root = getRoot(document); // SvgElement
root.attributes.fill = "currentColor";
```

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
- Character and entity references are decoded when parsing. When serializing, only `&`, `<`, `>`, and, in attribute values, `"` are escaped, along with characters that a parser would otherwise normalize: carriage returns in text, and tabs and line breaks in attribute values.
- Line breaks are normalized to `\n`, as XML requires.

Each test run checks these guarantees on 11,782 icons from Simple Icons, Bootstrap Icons, and Tabler Icons, on the checked-in [SVG corpus](./test/fixtures/README.md) of Inkscape, Adobe Illustrator, and Figma exports and SVGO regression inputs, and with property-based tests on generated documents.

## Errors

`parse()` throws an `SvgParseError` for malformed input. It has a `code` and the `line`, `column`, and `offset` of the problem:

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

Branch on `code`, not on the message text. Codes change only in major releases, while message text may change in any release:

| Code                             | Reason                                                           |
| -------------------------------- | ---------------------------------------------------------------- |
| `MALFORMED_XML`                  | The input is not well-formed XML.                                |
| `MISSING_ROOT`                   | The document has no root element.                                |
| `UNDECLARED_PREFIX`              | An element or attribute uses an undeclared namespace prefix.     |
| `UNDEFINED_ENTITY`               | A reference to an entity that is not declared.                   |
| `EXTERNAL_ENTITY`                | A reference to an external entity, which is never loaded.        |
| `UNSUPPORTED_ENTITY`             | A reference to an entity whose replacement text contains markup. |
| `MAX_INPUT_LENGTH_EXCEEDED`      | The input is longer than `maxInputLength`.                       |
| `MAX_DEPTH_EXCEEDED`             | Elements are nested deeper than `maxDepth`.                      |
| `MAX_ENTITY_EXPANSIONS_EXCEEDED` | More entity references than `maxEntityExpansions`.               |
| `MAX_EXPANDED_LENGTH_EXCEEDED`   | Expanded entity text longer than `maxExpandedLength`.            |

`stringify()` throws a `TypeError` for a tree that cannot be written as well-formed XML: an invalid name or character, an attribute value that is not a string, a comment containing `--`, a processing instruction containing `?>`, or a document without exactly one root element. Such trees can only come from code that builds or edits the tree, never from `parse()`.

## Safety

The parser is designed to handle untrusted input:

- External entities and external DTDs are never loaded.
- Entities declared in the DOCTYPE are expanded with limits that stop expansion attacks such as "billion laughs".
- Input length and element nesting depth are limited.

All limits have defaults, chosen by measuring real-world files:

| Option                | Default               | Measured maximum                                |
| --------------------- | --------------------- | ----------------------------------------------- |
| `maxInputLength`      | 67,108,864 characters | 90.8M characters; 99.9% of files are below 3.2M |
| `maxDepth`            | 1,024                 | 13 levels                                       |
| `maxEntityExpansions` | 10,000                | 7 references                                    |
| `maxExpandedLength`   | 1,048,576 characters  | 242 characters                                  |

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

### Performance

Median latency on Node.js 26.8.1, with how many times longer each library takes than svg-serde in parentheses.

Parsing:

| Input                        | svg-serde | svgson         | svg-parser     |
| ---------------------------- | --------- | -------------- | -------------- |
| Figma icon (435 bytes)       | 5.1 µs    | 30.5 µs (6.0×) | 14.3 µs (2.8×) |
| Inkscape icon (3.8 kB)       | 55.5 µs   | 230 µs (4.1×)  | 133 µs (2.4×)  |
| Illustrator file (752 bytes) | 9.1 µs    | 52.4 µs (5.8×) | 19.9 µs (2.2×) |
| 1,000 groups (92 kB)         | 1.3 ms    | 7.2 ms (5.7×)  | 4.0 ms (3.1×)  |
| 10,000 groups (937 kB)       | 14.7 ms   | 74.9 ms (5.1×) | 43.5 ms (3.0×) |
| One 1.1 MB path              | 642 µs    | 106 ms (165×)  | 71.2 ms (111×) |

Round trip, parsing and serializing again:

| Input                        | svg-serde | svgson         |
| ---------------------------- | --------- | -------------- |
| Figma icon (435 bytes)       | 10.7 µs   | 39.0 µs (3.6×) |
| Inkscape icon (3.8 kB)       | 92.1 µs   | 285 µs (3.1×)  |
| Illustrator file (752 bytes) | 17.6 µs   | 61.5 µs (3.5×) |
| 1,000 groups (92 kB)         | 2.4 ms    | 9.7 ms (4.0×)  |
| 10,000 groups (937 kB)       | 29.8 ms   | 109 ms (3.7×)  |
| One 1.1 MB path              | 1.3 ms    | 112 ms (86×)   |

`stringify()` alone is 1.2–3.3× faster than svgson's on these inputs, except for the single 1.1 MB attribute, where svgson's serializer is about 8× faster: svg-serde also checks that every character is allowed in XML, while svgson only replaces special characters. The libraries do different work, so these numbers compare end-to-end API costs, not equivalent output. Run `bun run bench` for Node.js or `bun run bench:bun` for Bun, and see the [benchmark guide](./scripts/benchmarks/README.md) for inputs, methodology, and limitations.

## Runtime support

`svg-serde` is an ESM-only package with TypeScript declarations. It targets:

- Node.js 22 or later
- Bun 1.2 or later
- Browsers that support ES2022

CI runs the test suite on Node.js 22, 24, and 26, on Bun 1.2.23 and the latest Bun release, and in Chromium, Firefox, and WebKit.

## Versioning

`svg-serde` follows [semantic versioning](https://semver.org/). Until version 1.0, the object model may still change:

- **0.x minor releases** (0.2 to 0.3) may contain breaking changes, which the release notes list.
- **0.x patch releases** (0.2.0 to 0.2.1) contain only fixes and compatible additions.

From version 1.0, breaking changes require a major release. This includes adding a node type, because it breaks exhaustive `switch` statements over `node.type`. Raising the minimum supported runtime versions is also a breaking change.

Release notes are published on [GitHub Releases](https://github.com/hexlabelposition/svg-serde/releases).

## Contributing

Feedback, bug reports, feature ideas, and design discussions are welcome through [GitHub Issues](https://github.com/hexlabelposition/svg-serde/issues). See [CONTRIBUTING.md](./CONTRIBUTING.md) for the development setup, conventions, and the release process.

## License

[MIT](./LICENSE)
