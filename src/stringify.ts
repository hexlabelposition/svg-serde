import type {
  SvgComment,
  SvgDocument,
  SvgElement,
  SvgInstruction,
  SvgNode,
  XmlDeclaration,
} from "./types";

/**
 * Serializes a document to an SVG string.
 *
 * Output is compact: no whitespace is added or removed, so text nodes are
 * written exactly as stored. Strings are escaped only where XML requires it,
 * attributes always use double quotes, and elements without children are
 * self-closing.
 *
 * Throws a `TypeError` when the tree cannot be written as well-formed XML,
 * for example an invalid element name or a comment containing `--`.
 */
export function stringify(document: SvgDocument): string {
  let output = "";

  if (document.declaration !== undefined) {
    output += stringifyDeclaration(document.declaration);
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
        output += stringifyElement(child);
        break;
      case "doctype":
        if (hasDoctype || hasRoot) {
          throw new TypeError(
            "A document can have one DOCTYPE, placed before the root element",
          );
        }
        hasDoctype = true;
        assertChars(child.value, "DOCTYPE");
        output += `<!DOCTYPE ${child.value}>`;
        break;
      case "text":
        // Character references are not allowed outside the root element,
        // so top-level text can only be raw whitespace.
        if (!WHITESPACE.test(child.value)) {
          throw new TypeError(
            `Text outside the root element must be whitespace: ${JSON.stringify(child.value)}`,
          );
        }
        output += child.value;
        break;
      case "comment":
        output += stringifyComment(child);
        break;
      case "instruction":
        output += stringifyInstruction(child);
        break;
      default:
        throw unknownNode(child);
    }
  }

  if (!hasRoot) {
    throw new TypeError("A document must have exactly one root element");
  }

  return output;
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
    if (standalone !== "yes" && standalone !== "no") {
      throw new TypeError(
        `Invalid XML standalone value: ${JSON.stringify(standalone)}`,
      );
    }
    output += ` standalone="${standalone}"`;
  }

  return `${output}?>`;
}

function stringifyNode(node: SvgNode): string {
  switch (node.type) {
    case "element":
      return stringifyElement(node);
    case "text":
      assertChars(node.value, "text");
      return node.value.replace(TEXT_SPECIAL_CHARS, escapeChar);
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

function stringifyElement(element: SvgElement): string {
  assertName(element.name, "element");
  let output = `<${element.name}`;

  for (const [name, value] of Object.entries(element.attributes)) {
    assertName(name, "attribute");
    assertChars(value, `attribute "${name}"`);
    output += ` ${name}="${value.replace(ATTRIBUTE_SPECIAL_CHARS, escapeChar)}"`;
  }

  if (element.children.length === 0) {
    return `${output}/>`;
  }

  output += ">";
  for (const child of element.children) {
    output += stringifyNode(child);
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

/**
 * XML `Name` production: https://www.w3.org/TR/xml/#NT-Name
 */
const NAME_START_CHARS =
  ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D" +
  "\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF" +
  "\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const NAME_CHARS = `${NAME_START_CHARS}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`;
const NAME = new RegExp(`^[${NAME_START_CHARS}][${NAME_CHARS}]*$`, "u");

/**
 * Characters outside the XML `Char` production: https://www.w3.org/TR/xml/#NT-Char
 */
const INVALID_CHAR = new RegExp(
  "[^\\t\\n\\r\\u0020-\\uD7FF\\uE000-\\uFFFD\\u{10000}-\\u{10FFFF}]",
  "u",
);

const WHITESPACE = /^[ \t\r\n]*$/;
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

function assertName(name: string, kind: string): void {
  if (!NAME.test(name)) {
    throw new TypeError(`Invalid ${kind} name: ${JSON.stringify(name)}`);
  }
}

function assertChars(value: string, kind: string): void {
  const match = INVALID_CHAR.exec(value);
  if (match !== null) {
    const codePoint = match[0].codePointAt(0) ?? 0;
    throw new TypeError(
      `Invalid character U+${codePoint.toString(16).toUpperCase().padStart(4, "0")} in ${kind}`,
    );
  }
}

function unknownNode(node: never): TypeError {
  const type = (node as { type?: unknown }).type;
  return new TypeError(`Unknown node type: ${JSON.stringify(type)}`);
}
