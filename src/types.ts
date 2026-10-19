import type { KnownSvgAttributeName, KnownSvgElementName } from "./known-names";

/**
 * Element name, stored exactly as written in the source, including any
 * namespace prefix (for example `"svg"`, `"linearGradient"`, `"sodipodi:namedview"`).
 *
 * Compare it with plain strings to find elements, e.g. `node.name === "path"`.
 * Standard SVG names are suggested by autocomplete, but any string is allowed.
 */
export type SvgElementName = KnownSvgElementName | (string & {});

/**
 * Element attributes, stored exactly as written in the source.
 *
 * Keys are qualified names including any prefix (`"xlink:href"`), and
 * namespace declarations (`"xmlns"`, `"xmlns:xlink"`) are ordinary attributes.
 * Values are always strings with character and entity references decoded.
 * Key order matches source order and is kept by `stringify()`.
 *
 * Read and change attributes as a plain object: `el.attributes.fill = "red"`,
 * `delete el.attributes.style`. Values are written back escaped as needed.
 * Standard SVG names are suggested by autocomplete, but any key is allowed.
 */
export type SvgAttributes = Partial<Record<KnownSvgAttributeName, string>> &
  Record<string, string>;

/**
 * The `<?xml ...?>` declaration at the start of a document.
 *
 * Present only when the source has one. Set or remove it to control whether
 * `stringify()` outputs a declaration.
 */
export interface XmlDeclaration {
  version: string;
  encoding?: string;
  standalone?: "yes" | "no";
}

/**
 * Root of a parsed document, returned by `parse()` and accepted by `stringify()`.
 *
 * Holds everything outside the root `<svg>` element as well, such as the XML
 * declaration, DOCTYPE, and top-level comments, so they survive a round trip.
 * To work with the SVG itself, call `getRoot(document)`.
 */
export interface SvgDocument {
  type: "document";
  declaration?: XmlDeclaration;
  /**
   * Top-level nodes in source order. Contains exactly one `SvgElement`.
   */
  children: SvgDocumentChild[];
}

/**
 * An element such as `<svg>`, `<g>`, or `<path>`.
 *
 * The main node to inspect and edit: change `attributes`, and add, remove,
 * or reorder `children` to change the output.
 */
export interface SvgElement {
  type: "element";
  name: SvgElementName;
  attributes: SvgAttributes;
  children: SvgNode[];
}

/**
 * Character data with character and entity references decoded.
 *
 * Holds visible text in `<text>` and `<tspan>`, the content of `<title>` and
 * `<desc>`, and whitespace between elements. Edit `value` as a plain string;
 * `stringify()` escapes it.
 */
export interface SvgText {
  type: "text";
  value: string;
}

/**
 * A `<![CDATA[...]]>` section; `value` is the content between the delimiters.
 *
 * Typically wraps CSS in `<style>` or code in `<script>`, so that characters
 * like `<` and `&` need no escaping. Kept separate from `SvgText` so the
 * section is written back as CDATA.
 */
export interface SvgCData {
  type: "cdata";
  value: string;
}

/**
 * A `<!--...-->` comment; `value` is the content between the delimiters.
 *
 * Kept so comments survive a round trip. Remove these nodes to strip comments
 * from the output.
 */
export interface SvgComment {
  type: "comment";
  value: string;
}

/**
 * A `<?target value?>` processing instruction other than the XML declaration.
 *
 * Rare in SVG; the usual case is `<?xml-stylesheet href="style.css"?>`.
 * Kept as is and never interpreted.
 */
export interface SvgInstruction {
  type: "instruction";
  target: string;
  value: string;
}

/**
 * A `<!DOCTYPE ...>` declaration; `value` is the raw content after the
 * `DOCTYPE` keyword, including the internal subset.
 *
 * Kept as is so it survives a round trip. Entities declared in it are already
 * expanded in the parsed tree, so it never needs to be read to use the document.
 * Remove the node to drop the DOCTYPE from the output.
 */
export interface SvgDoctype {
  type: "doctype";
  value: string;
}

/**
 * A node that can appear inside an element.
 *
 * Switch on `type` to handle each kind of node.
 */
export type SvgNode =
  SvgElement | SvgText | SvgCData | SvgComment | SvgInstruction;

/**
 * A node that can appear at the top level of a document.
 *
 * Switch on `type` to handle each kind of node.
 */
export type SvgDocumentChild =
  SvgElement | SvgText | SvgComment | SvgInstruction | SvgDoctype;

/**
 * Options for `parse()`.
 *
 * All limits have safe defaults. Lower them when parsing untrusted input with
 * tight resource budgets; raise them for unusually large trusted files.
 * Exceeding a limit throws an `SvgParseError`.
 */
export interface ParseOptions {
  /**
   * Maximum input length in characters, checked before parsing.
   * Defaults to 67,108,864 (64 MiB).
   */
  maxInputLength?: number;
  /**
   * Maximum element nesting depth. Protects against stack exhaustion.
   * Defaults to 1,024.
   */
  maxDepth?: number;
  /**
   * Maximum number of internal entity references expanded in a document.
   * Protects against entity expansion attacks ("billion laughs").
   * Defaults to 10,000.
   */
  maxEntityExpansions?: number;
  /**
   * Maximum total length of text produced by entity expansion.
   * Protects against entity expansion attacks ("billion laughs").
   * Defaults to 1,048,576 (1 MiB).
   */
  maxExpandedLength?: number;
}

/**
 * Options for `stringify()`.
 *
 * Use the defaults for compact output that keeps all whitespace as parsed;
 * enable `pretty` for human-readable output.
 */
export interface StringifyOptions {
  /**
   * Indent element-only content. Text content, such as inside `<text>` or
   * `<style>`, is never changed. Defaults to `false`.
   */
  pretty?: boolean;
  /** Spaces per indentation level when `pretty` is `true`. Defaults to `2`. */
  indent?: number;
}
