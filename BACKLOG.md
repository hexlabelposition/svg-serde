# Backlog

## Goal

**svg-serde** is an independent TypeScript library for converting SVG markup to plain JavaScript objects and back.

```text
SVG string <-> SVG object tree
```

It is intended for SVG editors, icon generators, graphics tooling, and other applications that need to inspect or modify SVG as structured data.

The main goals are predictable round-trip conversion, preservation of meaningful SVG data, strong TypeScript support, and a small API.

Compared with existing libraries such as `svgson` and `svg-parser`, svg-serde focuses on strict XML parsing, safe handling of untrusted input, and lossless preservation of every supported XML construct.

## Principles

- **Single responsibility:** Parse SVG and serialize its object representation. Do not turn the library into an SVG editor or general-purpose SDK.
- **Independence:** Maintain a standalone repository and npm package with no required connection to other projects.
- **TypeScript-first:** Provide clear node types, attribute types, options, and helpful editor autocomplete.
- **DOM-independent:** Expose plain JavaScript objects, with consistent behavior in Node.js, Bun, and browsers.
- **Plain data:** The object tree is JSON-safe: no classes, no cycles, no `undefined` values, no parent references. It can be stored, cloned with `structuredClone`, or sent to a worker as is.
- **Data preservation:** Preserve element hierarchy, child order, text, comments, namespaces, unknown elements, and unknown attributes within the documented supported scope.
- **No implicit interpretation:** Keep attribute values as strings. Do not automatically convert `"10"` to `10`, evaluate CSS, or resolve SVG transforms.
- **Correctness over zero dependencies:** Prefer a proven XML parser if implementing one from scratch would compromise correctness or security.
- **ESM-first:** Ship an ESM package with TypeScript declarations and explicit package exports.

## API

```ts
import { parse, stringify, getRoot, SvgParseError } from "svg-serde";

const document = parse(svgString);
const root = getRoot(document);
const result = stringify(document);

const formatted = stringify(document, {
  pretty: true,
  indent: 2,
});
```

Keep the public API small. Add features only when there is a clear use case.

### Parse options

```ts
interface ParseOptions {
  maxInputLength?: number; // reject larger inputs before parsing
  maxDepth?: number; // maximum element nesting depth
  maxEntityExpansions?: number; // maximum number of internal entity expansions
  maxExpandedLength?: number; // maximum total length of expanded entity text
}
```

All limits have safe defaults. Exact default values are chosen by measuring a corpus of real-world SVG files.

### Stringify options

```ts
interface StringifyOptions {
  pretty?: boolean; // default: false
  indent?: number; // default: 2, used only when pretty is true
}
```

### Errors

`parse()` throws a single error class:

```ts
class SvgParseError extends Error {
  code: string; // stable machine-readable code, e.g. "UNCLOSED_TAG", "MAX_DEPTH_EXCEEDED"
  line: number; // 1-based
  column: number; // 1-based
  offset: number; // 0-based character offset
}
```

`stringify()` throws a `TypeError` when the tree cannot be written as well-formed XML: invalid names, invalid characters, a comment containing `--`, a processing instruction containing `?>`, or a document without exactly one root element. Such trees can only come from code that builds or edits the tree, never from `parse()`.

### Object model

```ts
interface SvgDocument {
  type: "document";
  declaration?: XmlDeclaration;
  children: SvgDocumentChild[]; // exactly one SvgElement
}

interface XmlDeclaration {
  version: string;
  encoding?: string;
  standalone?: "yes" | "no";
}

interface SvgElement {
  type: "element";
  name: KnownSvgElementName | (string & {});
  attributes: SvgAttributes;
  children: SvgNode[];
}

interface SvgText {
  type: "text";
  value: string;
}

interface SvgCData {
  type: "cdata";
  value: string;
}

interface SvgComment {
  type: "comment";
  value: string;
}

interface SvgInstruction {
  type: "instruction";
  target: string;
  value: string;
}

interface SvgDoctype {
  type: "doctype";
  value: string; // raw declaration content, including the internal subset
}

type SvgNode = SvgElement | SvgText | SvgCData | SvgComment | SvgInstruction;
type SvgDocumentChild =
  SvgElement | SvgComment | SvgInstruction | SvgDoctype | SvgText;
```

Model rules:

- **Document root:** `parse()` always returns an `SvgDocument`. Comments, processing instructions, and the DOCTYPE outside the root element are kept in `document.children`. `getRoot(document)` returns a reference to its single root element and throws a `TypeError` if there are zero or multiple root elements.
- **Attribute order:** Guaranteed. `SvgAttributes` is a `Record<string, string>`; XML forbids duplicate attributes and attribute names cannot start with a digit, so JavaScript insertion order matches source order.
- **Namespaces:** Element and attribute names are stored exactly as written, including prefixes (`xlink:href`, `inkscape:label`). `xmlns` and `xmlns:*` declarations are ordinary attributes. Namespace URIs are not resolved. Using an undeclared prefix is a parse error.
- **Character and entity references:** Decoded to characters during parsing. `stringify()` escapes minimally: `&`, `<`, `>` in text, plus `"` in attribute values (always serialized with double quotes).
- **CDATA:** Kept as separate `cdata` nodes and serialized back as CDATA sections.
- **DOCTYPE and entities:** The DOCTYPE is stored as a raw string. Internal entities declared in the internal subset are expanded within the configured limits (this covers files exported from Adobe Illustrator). External entities and external DTDs are never loaded; referencing an external entity is a parse error. Because `saxes` does not process the internal subset, entity declarations are parsed by svg-serde itself. Only text replacements are supported: referencing an entity whose replacement text contains markup is a parse error (`UNSUPPORTED_ENTITY`). Parameter entities are not supported; as XML requires from processors that do not read external declarations, entity declarations after a parameter entity reference are ignored. Default attribute values from `<!ATTLIST>` are not applied.
- **Whitespace:** `parse()` preserves all text nodes, including whitespace-only nodes.

### Typing of known SVG names

Types provide autocomplete without restricting values:

- `KnownSvgElementName` is a union of standard SVG element names; `name` also accepts any string.
- `SvgAttributes` lists known SVG attribute names as optional string keys and also accepts any other string key.
- Name lists are generated at build time from maintained sources such as `svg-tag-names` and `svg-element-attributes`; these are dev dependencies only.
- Per-element discriminated unions are out of scope for the first release.

### Formatting rules

When `pretty` is `true`, `stringify()`:

- Replaces whitespace-only text nodes between elements with newlines and indentation, but only inside elements whose children are all non-text nodes.
- Leaves content unchanged inside elements with mixed content, elements with `xml:space="preserve"` (and their descendants), and `text`, `tspan`, `textPath`, `style`, `script`, `title`, and `desc`.

Compact output (`pretty: false`) serializes text nodes exactly as stored.

## Decisions

| Topic                               | Decision                                                                                                                                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| XML parser                          | `saxes` (strict XML, error positions, no external entity loading). The parser stays an internal detail and can be replaced without a breaking change.                                           |
| Document root                       | Separate `SvgDocument` root.                                                                                                                                                                    |
| CDATA, PI, DOCTYPE, XML declaration | Dedicated node types; the XML declaration is a `document.declaration` field.                                                                                                                    |
| Internal entities                   | Expanded with limits; external entities rejected.                                                                                                                                               |
| Character references                | Decoded on parse, minimally escaped on stringify.                                                                                                                                               |
| Whitespace                          | Preserved on parse; `pretty` only reformats element-only content. A `parse({ whitespace: "trim" })` option may be added on demand.                                                              |
| Round-trip equivalence              | See Quality Criteria.                                                                                                                                                                           |
| Namespaces                          | Qualified names as written, no URI resolution, undeclared prefixes rejected.                                                                                                                    |
| Attribute order                     | Guaranteed via `Record<string, string>`.                                                                                                                                                        |
| SVG typing                          | Autocomplete-only unions with `string & {}` fallback.                                                                                                                                           |
| Limits                              | Parse options with safe defaults.                                                                                                                                                               |
| Errors                              | Single `SvgParseError` class with `code`, `line`, `column`, `offset`. `stringify()` throws `TypeError` for trees that cannot be written as well-formed XML.                                     |
| Source positions on nodes           | Not in the first release; positions only in errors.                                                                                                                                             |
| Runtimes                            | Node.js >= 22, Bun >= 1.2, browsers supporting ES2022 (build target ES2022).                                                                                                                    |
| License                             | MIT.                                                                                                                                                                                            |
| Versioning                          | `0.x` until the model is stable; breaking changes allowed in minor releases. After `1.0`, adding a node type is a major release because it breaks exhaustive `switch` statements in TypeScript. |

## Functional Requirements

### P0: Core functionality

- [x] Document the exact behavior of `parse()` and `stringify()` according to the decisions above.
- [x] Integrate `saxes`; review its size, license, and dependencies (`xmlchars`).
- [x] Implement the object model types, including `XmlDeclaration`, `cdata`, `instruction`, and `doctype` nodes.
- [x] Implement `parse(svg, options?)` with XML well-formedness and namespace prefix validation.
- [x] Parse the DOCTYPE internal subset and expand internal entities within limits; reject external entities.
- [x] Implement `maxInputLength`, `maxDepth`, `maxEntityExpansions`, and `maxExpandedLength` with safe defaults.
- [x] Implement `SvgParseError` with stable error codes and line, column, and offset information.
- [x] Implement `stringify(document, options?)` with minimal, correct XML escaping.
- [x] Preserve element hierarchy, child order, mixed text content, and whitespace-only text nodes.
- [x] Preserve attribute values, order, casing, prefixes, and unknown attributes without implicit normalization.
- [x] Write round-trip tests that check the equivalence rules from Quality Criteria.
- [x] Add property-based round-trip tests with `fast-check`.
- [x] Build a test corpus of real-world files: Inkscape, Adobe Illustrator, and Figma exports, icon sets, and SVGO test fixtures (respecting their licenses).
- [x] Configure ESM output, `.d.ts` files, package `exports`, npm `files`, and the publishing workflow.
- [x] Add the MIT `LICENSE` file.

### P1: Developer experience and quality

- [x] Generate `KnownSvgElementName` and known attribute types from `svg-tag-names` and `svg-element-attributes` at build time.
- [x] Implement `pretty` and `indent` according to the formatting rules.
- [x] Choose default limit values based on measurements of the test corpus.
- [x] Document which lexical details are preserved or normalized: quote style, whitespace, entity references, and attribute order.
- [x] Document the versioning and stability policy.
- [x] Provide examples of modifying parsed objects before serializing them.
- [x] Write a README covering installation, API, supported environments, limitations, comparison with alternatives, and examples.
- [x] Test the library in Node.js 22+, Bun 1.2+, and a browser environment.
- [x] Configure CI for linting, type checking, tests, builds, and package validation.

### P2: Future considerations

- [x] Add a public `getRoot(document)` helper that returns the root element and rejects documents with zero or multiple root elements.
- [ ] Add a `parse({ whitespace: "trim" })` option if editors need cleaner trees.
- [ ] Add optional source positions on nodes (`parse({ positions: true })`) if code-editor use cases emerge.
- [ ] Consider optional transformation callbacks during parsing or serialization if clear use cases emerge.
- [x] Benchmark small and large SVG files against relevant alternatives, including `svgson` and `svg-parser` where operations are comparable.
- [ ] Optimize execution time and memory usage based on benchmark results.
- [ ] Evaluate streaming or incremental parsing only if real use cases justify the added complexity.
- [ ] Consider an optional mode for preserving more of the original XML syntax (quote style, entity spelling) if needed.

## Out of Scope

- Editor state, selection, layers, and undo/redo.
- High-level attribute editing, CSS manipulation, and style computation.
- Geometry, transform matrix calculations, and SVG path operations.
- Rendering and DOM interaction.
- Full SVG optimization or minification comparable to SVGO.
- Script execution, external resource resolution, and image loading.
- SVG embedded in HTML documents (HTML parsing rules).
- Namespace URI resolution.

These concerns may be handled by separate, independently maintained libraries. They do not need to share a monorepo or brand.

## Quality Criteria

1. **Semantic round-trip:** For compact output, `deepEqual(parse(stringify(doc)), doc)` holds for every document produced by `parse()`. For pretty output, the same holds after normalizing whitespace-only text nodes inside element-only content.
2. **No byte-for-byte guarantee:** Data equivalence does not imply identical whitespace, quote styles, or entity spelling.
3. **Safe parsing:** Malformed or potentially malicious XML fails predictably with `SvgParseError`, without external requests or uncontrolled resource consumption.
4. **Verified compatibility:** Test results cover every officially supported runtime.
5. **Measured performance:** Any claims about speed or package size must be backed by reproducible measurements.

## Test Cases

- Empty `<svg/>` elements, nested groups, and self-closing elements.
- Common SVG elements: `rect`, `circle`, `path`, `defs`, `use`, `linearGradient`, `mask`, `clipPath`, and `filter`.
- Text with spaces and line breaks, including `<text>`, `<tspan>`, and `xml:space="preserve"`.
- Escaped attribute values, including `&amp;`, `&quot;`, and `&lt;`, numeric character references, URLs, and units.
- Namespaces, including `xmlns`, `xlink:href`, custom prefixes, and undeclared prefixes (error).
- Comments, CDATA in `<style>` and `<script>`, XML declarations, processing instructions, and DOCTYPE declarations before and after the root element.
- Internal entities declared in the DOCTYPE (Adobe Illustrator style), external entities (error), and entity expansion bombs (error).
- Mixed content and strict child ordering.
- Unknown elements and attributes, `data-*` attributes, and CSS custom properties.
- Pretty output that must not change mixed content or preserved text.
- Malformed tags, unterminated quotes, invalid characters, inputs exceeding `maxInputLength`, and documents exceeding `maxDepth`.

## First Release Definition of Done

The first release is ready when `parse()` and `stringify()` work reliably in the supported environments, public TypeScript declarations are included, round-trip equivalence is verified by unit, property-based, and real-world corpus tests, XML behavior and security limitations are documented, and the published npm package passes build and packaging checks.
