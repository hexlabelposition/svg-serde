import { SaxesParser, type SaxesAttributeNS } from "saxes";
import { parseEntityDeclarations } from "./doctype";
import { createEntityResolver } from "./entities";
import { SvgParseError, type SvgParseErrorCode } from "./errors";
import { createPointTracker } from "./position";
import type {
  ParseOptions,
  SvgDocument,
  SvgDocumentChild,
  SvgElement,
  SvgNode,
  SvgPoint,
  XmlDeclaration,
} from "./types";
import { trimWhitespace } from "./whitespace";
import { INVALID_CHAR } from "./xml";

/**
 * Default limits used by `parse()`.
 *
 * Measured on 16,904 real-world files (icon sets, KDE Oxygen icons exported
 * from Inkscape and Illustrator, the W3C SVG 1.1 test suite, and large
 * Wikimedia Commons maps): the 99.9th percentile of input length is 3.2M
 * characters and the largest map has 90.8M; the deepest nesting is 13
 * levels; files exported from Illustrator expand at most 7 entity references
 * into 242 characters.
 *
 * Parsing takes time linear in the input length, about 3 seconds for 90M
 * characters, so the input length limit only rejects files that are larger
 * than any typical SVG. The other limits leave a wide margin above real-world
 * use while stopping deeply nested and entity expansion attacks.
 */
const DEFAULT_MAX_INPUT_LENGTH = 64 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 1024;
const DEFAULT_MAX_ENTITY_EXPANSIONS = 10_000;
const DEFAULT_MAX_EXPANDED_LENGTH = 1024 * 1024;

/**
 * Parses an SVG string into a document.
 *
 * The input must be well-formed XML with exactly one root element. Names,
 * attribute values, and text are kept as written, with character and entity
 * references decoded and line breaks normalized to `"\n"` as XML requires.
 * Entities declared in the DOCTYPE internal subset are expanded; external
 * entities and external DTDs are never loaded.
 *
 * With `whitespace: "trim"`, whitespace-only text between elements is
 * removed; text content is never changed. With `positions: true`, every node
 * gets a `position` with its source range.
 *
 * Throws an `SvgParseError` for malformed input or when a limit from
 * `options` is exceeded, and a `RangeError` for an invalid `whitespace`
 * option.
 */
export function parse(svg: string, options: ParseOptions = {}): SvgDocument {
  const maxInputLength = options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const entityLimits = {
    maxEntityExpansions:
      options.maxEntityExpansions ?? DEFAULT_MAX_ENTITY_EXPANSIONS,
    maxExpandedLength: options.maxExpandedLength ?? DEFAULT_MAX_EXPANDED_LENGTH,
  };
  const whitespace = options.whitespace ?? "preserve";
  // Options passed at runtime may hold any value despite the type.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  if (whitespace !== "preserve" && whitespace !== "trim") {
    throw new RangeError(
      `whitespace must be "preserve" or "trim": ${JSON.stringify(whitespace)}`,
    );
  }

  if (svg.length > maxInputLength) {
    throw new SvgParseError(
      `Input is longer than ${maxInputLength} characters`,
      { code: "MAX_INPUT_LENGTH_EXCEEDED", line: 1, column: 1, offset: 0 },
    );
  }

  // saxes accepts some characters that XML forbids, such as unpaired
  // surrogates in comments, so check the whole input up front.
  const invalidChar = INVALID_CHAR.exec(svg);
  if (invalidChar !== null) {
    const codePoint = invalidChar[0].codePointAt(0) ?? 0;
    throw new SvgParseError(
      `Invalid character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`,
      {
        code: "MALFORMED_XML",
        ...createPointTracker(svg)(invalidChar.index),
      },
    );
  }

  const parser = new SaxesParser({ xmlns: true, position: true });
  let children: SvgDocumentChild[] = [];

  const positions = options.positions === true;
  const pointAt = createPointTracker(svg);
  // Tokens follow each other without gaps, so each node starts where the
  // previous token ends.
  let tokenEnd = svg.startsWith("\uFEFF") ? 1 : 0;
  const elementStarts: SvgPoint[] = [];

  const locate = <T extends SvgNode | SvgDocumentChild>(
    node: T,
    end: number,
  ): T => {
    if (positions) {
      node.position = { start: pointAt(tokenEnd), end: pointAt(end) };
    }
    tokenEnd = end;
    return node;
  };

  // saxes skips whitespace at the start of the document without reporting it.
  const leadingWhitespace = DOCUMENT_START_WHITESPACE.exec(svg)?.[1];
  if (leadingWhitespace !== undefined) {
    children.push(
      locate(
        { type: "text", value: leadingWhitespace.replace(LINE_BREAK, "\n") },
        tokenEnd + leadingWhitespace.length,
      ),
    );
  }
  let declaration: XmlDeclaration | undefined;
  const stack: SvgElement[] = [];

  const append = (node: SvgNode | SvgDocumentChild): void => {
    const parent = stack.at(-1);
    if (parent === undefined) {
      children.push(node as SvgDocumentChild);
    } else {
      parent.children.push(node as SvgNode);
    }
  };

  parser.on("xmldecl", ({ version, encoding, standalone }) => {
    declaration = { version: version ?? "1.0" };
    if (encoding !== undefined) {
      declaration.encoding = encoding;
    }
    if (standalone === "yes" || standalone === "no") {
      declaration.standalone = standalone;
    }
    tokenEnd = parser.position;
  });

  parser.on("doctype", (value) => {
    // saxes includes the whitespace after the DOCTYPE keyword, which
    // stringify() writes back as a single space.
    append(
      locate(
        { type: "doctype", value: value.replace(LEADING_WHITESPACE, "") },
        parser.position,
      ),
    );

    const declarations = parseEntityDeclarations(value, (message) => {
      throw positionedError(parser, message, "MALFORMED_XML");
    });
    const resolve = createEntityResolver(
      declarations,
      entityLimits,
      (message, code) => {
        throw positionedError(parser, message, code);
      },
    );

    // saxes looks up each entity reference in ENTITIES and inserts the
    // result as text, so getters expand entities on use.
    for (const name of declarations.keys()) {
      Object.defineProperty(parser.ENTITIES, name, {
        get: () => resolve(name),
        enumerable: true,
        configurable: true,
      });
    }
  });

  parser.on("processinginstruction", ({ target, body }) => {
    append(
      locate(
        { type: "instruction", target, value: body },
        svg.indexOf("?>", tokenEnd + 2) + 2,
      ),
    );
  });

  parser.on("comment", (value) => {
    append(
      locate({ type: "comment", value }, svg.indexOf("-->", tokenEnd + 4) + 3),
    );
  });

  parser.on("cdata", (value) => {
    append(
      locate({ type: "cdata", value }, svg.indexOf("]]>", tokenEnd + 9) + 3),
    );
  });

  parser.on("text", (value) => {
    // saxes reports text after reading the "<" that ends it, except at the
    // end of the input.
    const end =
      svg.charCodeAt(parser.position - 1) === 0x3c
        ? parser.position - 1
        : parser.position;
    if (value === "") {
      tokenEnd = end;
    } else {
      append(locate({ type: "text", value }, end));
    }
  });

  parser.on("opentag", (tag) => {
    if (stack.length >= maxDepth) {
      throw positionedError(
        parser,
        `Elements are nested deeper than ${maxDepth} levels`,
        "MAX_DEPTH_EXCEEDED",
      );
    }

    const attributes: Record<string, string> = {};
    // for...in avoids allocating an array of entries for every element.
    for (const name in tag.attributes) {
      attributes[name] = (tag.attributes[name] as SaxesAttributeNS).value;
    }

    const element: SvgElement = {
      type: "element",
      name: tag.name,
      attributes,
      children: [],
    };
    append(element);
    stack.push(element);
    if (positions) {
      elementStarts.push(pointAt(tokenEnd));
    }
    tokenEnd = parser.position;
  });

  parser.on("closetag", () => {
    const element = stack.pop();
    // Arrays reserve room for more items as they grow; copying gives the
    // array an exact capacity, which saves memory in large trees where most
    // elements have few children.
    if (element !== undefined && element.children.length > 0) {
      element.children = element.children.slice();
    }
    const start = elementStarts.pop();
    if (element !== undefined && start !== undefined) {
      element.position = { start, end: pointAt(parser.position) };
    }
    tokenEnd = parser.position;
  });

  try {
    parser.write(svg).close();
  } catch (error) {
    if (error instanceof SvgParseError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw positionedError(
      parser,
      formatSaxesMessage(message),
      saxesErrorCode(message),
      error,
    );
  }

  if (whitespace === "trim") {
    children = trimWhitespace(children);
  }

  return declaration === undefined
    ? { type: "document", children }
    : { type: "document", declaration, children };
}

const LEADING_WHITESPACE = /^[ \t\r\n]+/;
const DOCUMENT_START_WHITESPACE = /^\uFEFF?([ \t\r\n]+)/;
const LINE_BREAK = /\r\n?/g;

/**
 * saxes messages start with "line:column: " and end with a period.
 */
const SAXES_MESSAGE = /^(?:\d+:\d+: )?(.*?)\.?$/s;

function formatSaxesMessage(message: string): string {
  const text = SAXES_MESSAGE.exec(message)?.[1] ?? message;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function saxesErrorCode(message: string): SvgParseErrorCode {
  if (message.includes("unbound namespace prefix")) {
    return "UNDECLARED_PREFIX";
  }
  if (message.includes("undefined entity")) {
    return "UNDEFINED_ENTITY";
  }
  if (message.includes("document must contain a root element")) {
    return "MISSING_ROOT";
  }
  return "MALFORMED_XML";
}

function positionedError(
  parser: SaxesParser,
  message: string,
  code: SvgParseErrorCode,
  cause?: unknown,
): SvgParseError {
  return new SvgParseError(message, {
    code,
    line: parser.line,
    column: parser.columnIndex + 1,
    offset: parser.position,
    cause,
  });
}
