import { SaxesParser } from "saxes";
import { parseEntityDeclarations } from "./doctype";
import { createEntityResolver } from "./entities";
import { SvgParseError, type SvgParseErrorCode } from "./errors";
import type {
  ParseOptions,
  SvgDocument,
  SvgDocumentChild,
  SvgElement,
  SvgNode,
  XmlDeclaration,
} from "./types";
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
 * Throws an `SvgParseError` for malformed input or when a limit from
 * `options` is exceeded.
 */
export function parse(svg: string, options: ParseOptions = {}): SvgDocument {
  const maxInputLength = options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const entityLimits = {
    maxEntityExpansions:
      options.maxEntityExpansions ?? DEFAULT_MAX_ENTITY_EXPANSIONS,
    maxExpandedLength: options.maxExpandedLength ?? DEFAULT_MAX_EXPANDED_LENGTH,
  };

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
      { code: "MALFORMED_XML", ...positionAt(svg, invalidChar.index) },
    );
  }

  const parser = new SaxesParser({ xmlns: true, position: true });
  const children: SvgDocumentChild[] = [];

  // saxes skips whitespace at the start of the document without reporting it.
  const leadingWhitespace = DOCUMENT_START_WHITESPACE.exec(svg)?.[1];
  if (leadingWhitespace !== undefined) {
    children.push({
      type: "text",
      value: leadingWhitespace.replace(LINE_BREAK, "\n"),
    });
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
  });

  parser.on("doctype", (value) => {
    // saxes includes the whitespace after the DOCTYPE keyword, which
    // stringify() writes back as a single space.
    append({ type: "doctype", value: value.replace(LEADING_WHITESPACE, "") });

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
    append({ type: "instruction", target, value: body });
  });

  parser.on("comment", (value) => {
    append({ type: "comment", value });
  });

  parser.on("cdata", (value) => {
    append({ type: "cdata", value });
  });

  parser.on("text", (value) => {
    if (value !== "") {
      append({ type: "text", value });
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
    for (const [name, attribute] of Object.entries(tag.attributes)) {
      attributes[name] = attribute.value;
    }

    const element: SvgElement = {
      type: "element",
      name: tag.name,
      attributes,
      children: [],
    };
    append(element);
    stack.push(element);
  });

  parser.on("closetag", () => {
    stack.pop();
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

/**
 * Computes the 1-based line and column of a character offset.
 */
function positionAt(
  svg: string,
  offset: number,
): { line: number; column: number; offset: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    const char = svg.charAt(i);
    if (char === "\n" || (char === "\r" && svg.charAt(i + 1) !== "\n")) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1, offset };
}
