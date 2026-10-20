import type {
  SvgComment,
  SvgDocument,
  SvgElement,
  SvgInstruction,
  SvgNode,
  StringifyOptions,
  XmlDeclaration,
} from "./types";
import { isElementOnly, WHITESPACE } from "./whitespace";
import { INVALID_CHAR, NAME } from "./xml";

/**
 * Serializes a document to an SVG string.
 *
 * By default, output is compact: no whitespace is added or removed, so text
 * nodes are written exactly as stored. With `pretty`, whitespace-only text in
 * element-only content is replaced with line breaks and indentation; text
 * content is never changed. Strings are escaped only where XML requires it,
 * attributes always use double quotes, and elements without children are
 * self-closing.
 *
 * Throws a `TypeError` when the tree cannot be written as well-formed XML,
 * for example an invalid element name or a comment containing `--`, and a
 * `RangeError` when `indent` is not a non-negative integer.
 */
export function stringify(
  document: SvgDocument,
  options: StringifyOptions = {},
): string {
  const indent = options.pretty === true ? resolveIndent(options) : undefined;
  const parts: string[] = [];

  if (document.declaration !== undefined) {
    parts.push(stringifyDeclaration(document.declaration));
  }

  let hasRoot = false;
  let hasDoctype = false;

  for (const child of document.children) {
    switch (child.type) {
      case "element":
        if (hasRoot) {
          throw new TypeError("A document must have exactly one root element");
        }
        hasRoot = true;
        parts.push(stringifyElement(child, indent, ""));
        break;
      case "doctype":
        if (hasDoctype || hasRoot) {
          throw new TypeError(
            "A document can have one DOCTYPE, placed before the root element",
          );
        }
        hasDoctype = true;
        assertChars(child.value, "DOCTYPE");
        parts.push(`<!DOCTYPE ${child.value}>`);
        break;
      case "text":
        // Character references are not allowed outside the root element,
        // so top-level text can only be raw whitespace.
        if (!WHITESPACE.test(child.value)) {
          throw new TypeError(
            `Text outside the root element must be whitespace: ${JSON.stringify(child.value)}`,
          );
        }
        if (indent === undefined) {
          parts.push(child.value);
        }
        break;
      case "comment":
        parts.push(stringifyComment(child));
        break;
      case "instruction":
        parts.push(stringifyInstruction(child));
        break;
      default:
        throw unknownNode(child);
    }
  }

  if (!hasRoot) {
    throw new TypeError("A document must have exactly one root element");
  }

  return parts.join(indent === undefined ? "" : "\n");
}

function resolveIndent(options: StringifyOptions): string {
  const indent = options.indent ?? 2;
  if (!Number.isInteger(indent) || indent < 0) {
    throw new RangeError(
      `indent must be a non-negative integer: ${String(indent)}`,
    );
  }
  return " ".repeat(indent);
}

function stringifyDeclaration(declaration: XmlDeclaration): string {
  const { version, encoding, standalone } = declaration;

  if (!VERSION.test(version)) {
    throw new TypeError(`Invalid XML version: ${JSON.stringify(version)}`);
  }
  let output = `<?xml version="${version}"`;

  if (encoding !== undefined) {
    if (!ENCODING.test(encoding)) {
      throw new TypeError(`Invalid XML encoding: ${JSON.stringify(encoding)}`);
    }
    output += ` encoding="${encoding}"`;
  }

  if (standalone !== undefined) {
    // Trees built at runtime may hold any value despite the type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (standalone !== "yes" && standalone !== "no") {
      throw new TypeError(
        `Invalid XML standalone value: ${JSON.stringify(standalone)}`,
      );
    }
    output += ` standalone="${standalone}"`;
  }

  return `${output}?>`;
}

/**
 * `indent` is the indentation step when formatting, or `undefined` for
 * compact output; `prefix` is the indentation of the current line.
 */
function stringifyNode(
  node: SvgNode,
  indent: string | undefined,
  prefix: string,
): string {
  switch (node.type) {
    case "element":
      return stringifyElement(node, indent, prefix);
    case "text":
      assertChars(node.value, "text");
      return escapeText(node.value);
    case "cdata":
      assertChars(node.value, "CDATA section");
      // "]]>" cannot appear inside a CDATA section, so split the section
      // between "]]" and ">".
      return `<![CDATA[${node.value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
    case "comment":
      return stringifyComment(node);
    case "instruction":
      return stringifyInstruction(node);
    default:
      throw unknownNode(node);
  }
}

function stringifyElement(
  element: SvgElement,
  indent: string | undefined,
  prefix: string,
): string {
  assertName(element.name, "element");
  let output = `<${element.name}`;

  const { attributes } = element;
  // Object.keys() avoids allocating an entry array for every attribute;
  // for...in would also visit inherited properties of hand-built objects.
  for (const name of Object.keys(attributes)) {
    const value = attributes[name];
    assertName(name, "attribute");
    if (typeof value !== "string") {
      throw new TypeError(
        `Attribute "${name}" must be a string: ${JSON.stringify(value)}`,
      );
    }
    assertChars(value, "attribute", name);
    output += ` ${name}="${escapeAttribute(value)}"`;
  }

  if (indent !== undefined && isElementOnly(element)) {
    // Whitespace-only text is replaced by the formatting below.
    const children = element.children.filter((child) => child.type !== "text");
    if (children.length === 0) {
      return `${output}/>`;
    }

    output += ">";
    const childPrefix = prefix + indent;
    for (const child of children) {
      output += `\n${childPrefix}${stringifyNode(child, indent, childPrefix)}`;
    }
    return `${output}\n${prefix}</${element.name}>`;
  }

  if (element.children.length === 0) {
    return `${output}/>`;
  }

  // Content that is not reformatted keeps its descendants compact as well,
  // since whitespace inside them can be significant too.
  output += ">";
  for (const child of element.children) {
    output += stringifyNode(child, undefined, prefix);
  }
  return `${output}</${element.name}>`;
}

function stringifyComment(comment: SvgComment): string {
  assertChars(comment.value, "comment");
  if (comment.value.includes("--") || comment.value.endsWith("-")) {
    throw new TypeError(
      `A comment cannot contain "--" or end with "-": ${JSON.stringify(comment.value)}`,
    );
  }
  return `<!--${comment.value}-->`;
}

function stringifyInstruction(instruction: SvgInstruction): string {
  const { target, value } = instruction;

  assertName(target, "processing instruction target");
  if (target.toLowerCase() === "xml") {
    throw new TypeError(
      'Use SvgDocument.declaration instead of an "xml" processing instruction',
    );
  }

  assertChars(value, "processing instruction");
  if (value.includes("?>")) {
    throw new TypeError(
      `A processing instruction cannot contain "?>": ${JSON.stringify(value)}`,
    );
  }

  return value === "" ? `<?${target}?>` : `<?${target} ${value}?>`;
}

const VERSION = /^1\.[0-9]+$/;
const ENCODING = /^[A-Za-z][A-Za-z0-9._-]*$/;

/**
 * "\r" is escaped because parsers normalize raw line breaks to "\n".
 */
const TEXT_SPECIAL_CHARS = /[&<>\r]/g;

/**
 * "\t", "\n", and "\r" are escaped because parsers normalize raw whitespace
 * in attribute values to spaces.
 */
const ATTRIBUTE_SPECIAL_CHARS = /[&<>"\t\n\r]/g;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "\t": "&#9;",
  "\n": "&#10;",
  "\r": "&#13;",
};

function escapeChar(char: string): string {
  return ESCAPES[char] ?? char;
}

/**
 * Values longer than this are checked for special characters with
 * `indexOf()`, which engines run with vectorized native code, before
 * escaping. A character class makes the engine test every character in turn,
 * which is several times slower on long values that need no escaping, such
 * as path data. Short values are faster with a single regular expression.
 */
const LONG_VALUE = 256;

function escapeText(value: string): string {
  if (
    value.length > LONG_VALUE &&
    !value.includes("&") &&
    !value.includes("<") &&
    !value.includes(">") &&
    !value.includes("\r")
  ) {
    return value;
  }
  return value.replace(TEXT_SPECIAL_CHARS, escapeChar);
}

function escapeAttribute(value: string): string {
  if (
    value.length > LONG_VALUE &&
    !value.includes("&") &&
    !value.includes("<") &&
    !value.includes(">") &&
    !value.includes('"') &&
    !value.includes("\t") &&
    !value.includes("\n") &&
    !value.includes("\r")
  ) {
    return value;
  }
  return value.replace(ATTRIBUTE_SPECIAL_CHARS, escapeChar);
}

/**
 * Names known to be valid. Documents repeat a few names many times, and
 * testing a name against `NAME` is slower than a set lookup. The set is
 * cleared when full, so arbitrary names cannot grow it without bound.
 */
const validNames = new Set<string>();
const MAX_VALID_NAMES = 1024;

function assertName(name: string, kind: string): void {
  if (validNames.has(name)) {
    return;
  }
  if (!NAME.test(name)) {
    throw new TypeError(`Invalid ${kind} name: ${JSON.stringify(name)}`);
  }
  if (validNames.size >= MAX_VALID_NAMES) {
    validNames.clear();
  }
  validNames.add(name);
}

/**
 * `name` names the attribute or other item, separate from `kind` so that the
 * message is only built on failure.
 */
function assertChars(value: string, kind: string, name?: string): void {
  const match = INVALID_CHAR.exec(value);
  if (match !== null) {
    const codePoint = match[0].codePointAt(0) ?? 0;
    const item = name === undefined ? kind : `${kind} "${name}"`;
    throw new TypeError(
      `Invalid character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} in ${item}`,
    );
  }
}

function unknownNode(node: never): TypeError {
  const type = (node as { type?: unknown }).type;
  return new TypeError(`Unknown node type: ${JSON.stringify(type)}`);
}
