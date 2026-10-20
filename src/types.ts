/**
 * Element name, stored exactly as written in the source, including any
 * namespace prefix (for example `"svg"`, `"linearGradient"`, `"sodipodi:namedview"`).
 *
 * Compare it with plain strings to find elements, e.g. `node.name === "path"`.
 */
export type SvgElementName = string;

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
 */
export type SvgAttributes = Record<string, string>;

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
  /** Source range, present only when parsed with `positions: true`. */
  position?: SvgPosition;
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
  /** Source range, present only when parsed with `positions: true`. */
  position?: SvgPosition;
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
  /** Source range, present only when parsed with `positions: true`. */
  position?: SvgPosition;
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
  /** Source range, present only when parsed with `positions: true`. */
  position?: SvgPosition;
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
  /** Source range, present only when parsed with `positions: true`. */
  position?: SvgPosition;
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
  /** Source range, present only when parsed with `positions: true`. */
  position?: SvgPosition;
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
 * A location in the source string.
 *
 * `offset` is the 0-based index in the string, counted in UTF-16 code units
 * like JavaScript string indexes. `line` and `column` are 1-based; `column`
 * counts code units from the start of the line, and `"\r\n"`, `"\r"`, and
 * `"\n"` each end a line.
 */
export interface SvgPoint {
  line: number;
  column: number;
  offset: number;
}

/**
 * The source range of a node, added by `parse()` with `positions: true`.
 *
 * `start` is the first character of the node and `end` is the character after
 * it, so `source.slice(start.offset, end.offset)` is the node as written,
 * with references not yet decoded. An element range covers everything from
 * its start tag to its end tag.
 *
 * Positions describe the parsed source only: `stringify()` ignores them, and
 * they are not updated when the tree changes.
 */
export interface SvgPosition {
  start: SvgPoint;
  end: SvgPoint;
}

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
  /**
   * `"preserve"` keeps every text node. `"trim"` removes whitespace-only text
   * between elements, by the same rules as `pretty` in `stringify()`: text
   * content, such as inside `<text>` or `<style>`, is never changed.
   * Defaults to `"preserve"`.
   */
  whitespace?: "preserve" | "trim";
  /**
   * Add a `position` with the source range to every node, for tools that map
   * nodes back to the source, such as code editors. Defaults to `false`.
   */
  positions?: boolean;
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
