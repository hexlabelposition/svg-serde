import { SaxesParser } from "saxes";
import { SvgParseError, type SvgParseErrorCode } from "./errors";
import type {
  ParseOptions,
  SvgDocument,
  SvgDocumentChild,
  SvgElement,
  SvgNode,
  XmlDeclaration,
} from "./types";

/**
 * Default limits used by `parse()`.
 *
 * Provisional values, to be tuned on a corpus of real-world SVG files.
 */
const DEFAULT_MAX_INPUT_LENGTH = 64 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 1024;

/**
 * Parses an SVG string into a document.
 *
 * The input must be well-formed XML with exactly one root element. Names,
 * attribute values, and text are kept as written, with character and entity
 * references decoded and line breaks normalized to `"\n"` as XML requires.
 * External resources are never loaded.
 *
 * Throws an `SvgParseError` for malformed input or when a limit from
 * `options` is exceeded.
 */
export function parse(svg: string, options: ParseOptions = {}): SvgDocument {
  const maxInputLength = options.maxInputLength ?? DEFAULT_MAX_INPUT_LENGTH;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;

  if (svg.length > maxInputLength) {
    throw new SvgParseError(
      `Input is longer than ${maxInputLength} characters`,
      { code: "MAX_INPUT_LENGTH_EXCEEDED", line: 1, column: 1, offset: 0 },
    );
  }

  const parser = new SaxesParser({ xmlns: true, position: true });
  const children: SvgDocumentChild[] = [];
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
