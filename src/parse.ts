import {
  BANG,
  DQUOTE,
  EQUAL,
  GT,
  HASH,
  isWhitespace,
  LOWER_X,
  QUESTION,
  SLASH,
  SQUOTE,
} from "./chars";
import { parseDeclaration } from "./declaration";
import { findDoctypeEnd, parseEntityDeclarations } from "./doctype";
import { createEntityResolver } from "./entities";
import { SvgParseError, type SvgParseErrorCode } from "./errors";
import {
  checkNamespace,
  splitPrefix,
  XML_NAMESPACE,
  XMLNS_NAMESPACE,
} from "./namespaces";
import { createPointTracker } from "./position";
import type {
  ParseOptions,
  SvgDocument,
  SvgDocumentChild,
  SvgElement,
  SvgNode,
  SvgSourcePoint,
  XmlDeclaration,
} from "./types";
import { trimWhitespace } from "./whitespace";
import { INVALID_CHAR, isXmlChar, NAME, NAME_TABLE, scanName } from "./xml";

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
 * Parsing takes time linear in the input length, so the input length limit
 * only rejects files that are larger than any typical SVG. The other limits
 * leave a wide margin above real-world use while stopping deeply nested and
 * entity expansion attacks.
 */
const DEFAULT_MAX_INPUT_LENGTH = 64 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 1024;
const DEFAULT_MAX_ENTITY_EXPANSIONS = 10_000;
const DEFAULT_MAX_EXPANDED_LENGTH = 1024 * 1024;

// Line breaks, normalized to "\n". XML 1.1 also counts U+0085 and U+2028.
const LINE_BREAK = /\r\n?/g;
const LINE_BREAK_11 = /\r[\n\u0085]?|[\u0085\u2028]/g;
// Attribute value normalization: each tab and each line break, with "\r\n"
// counted as one, becomes a space.
const ATTRIBUTE_WHITESPACE = /\r\n?|[\t\n]/g;
const ATTRIBUTE_WHITESPACE_11 = /\r[\n\u0085]?|[\t\n\u0085\u2028]/g;
const LEADING_WHITESPACE = /^[ \t\n]+/;

/**
 * Parses an SVG string into a document.
 *
 * The input must be well-formed XML with exactly one root element. Names,
 * attribute values, and text are kept as written, except as XML requires:
 * character and entity references are decoded, line breaks become `"\n"`,
 * and tabs and line breaks in attribute values become spaces.
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

  // One native regular expression pass over the whole input is faster than
  // checking every character in the tokenizer.
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

  const length = svg.length;
  const positions = options.positions === true;
  const pointAt = createPointTracker(svg);

  const fail = (
    message: string,
    offset: number,
    code: SvgParseErrorCode = "MALFORMED_XML",
  ): never => {
    throw new SvgParseError(message, {
      code,
      ...createPointTracker(svg)(Math.min(offset, length)),
    });
  };

  // Offsets of the next occurrence of a string at or after the last searched
  // offset, or `length` if there is none. A search runs again only once the
  // parser has moved past the previous result, so the input is scanned for
  // each string at most once in total and most tokens need no search at all.
  let nextLt = -1;
  let nextAmp = -1;
  let nextCr = -1;
  let nextTab = -1;
  let nextLf = -1;
  let nextCdataEnd = -1;
  const find = (search: string, from: number): number => {
    const index = svg.indexOf(search, from);
    return index === -1 ? length : index;
  };

  let xml11 = false;
  let lineBreak = LINE_BREAK;
  let attributeWhitespace = ATTRIBUTE_WHITESPACE;

  /**
   * Normalizes line breaks in `svg.slice(start, end)`.
   */
  const raw = (start: number, end: number): string => {
    const value = svg.slice(start, end);
    if (xml11) {
      return value.replace(lineBreak, "\n");
    }
    if (nextCr < start) {
      nextCr = find("\r", start);
    }
    return nextCr < end ? value.replace(LINE_BREAK, "\n") : value;
  };

  let resolveEntity: ((name: string) => string) | undefined;
  let referenceOffset = 0;

  /**
   * Decodes the reference from `&` at `start` to `;` at `end`.
   */
  const decodeReference = (start: number, end: number): string => {
    if (svg.charCodeAt(start + 1) === HASH) {
      let index = start + 2;
      const hex = svg.charCodeAt(index) === LOWER_X;
      if (hex) {
        index++;
      }
      if (index === end) {
        fail("Malformed character reference", start);
      }
      let codePoint = 0;
      for (; index < end; index++) {
        const c = svg.charCodeAt(index);
        let digit: number;
        if (c >= 0x30 && c <= 0x39) {
          digit = c - 0x30;
        } else if (hex && c >= 0x61 && c <= 0x66) {
          digit = c - 0x57;
        } else if (hex && c >= 0x41 && c <= 0x46) {
          digit = c - 0x37;
        } else {
          return fail("Malformed character reference", start);
        }
        codePoint = codePoint * (hex ? 16 : 10) + digit;
        if (codePoint > 0x10ffff) {
          fail("Malformed character reference", start);
        }
      }
      if (!isXmlChar(codePoint)) {
        fail("Malformed character reference", start);
      }
      return String.fromCodePoint(codePoint);
    }

    const name = svg.slice(start + 1, end);
    switch (name) {
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "amp":
        return "&";
      case "quot":
        return '"';
      case "apos":
        return "'";
      default:
    }
    if (!NAME.test(name)) {
      fail("Malformed entity reference", start);
    }
    if (resolveEntity === undefined) {
      return fail(`Undefined entity: ${name}`, start, "UNDEFINED_ENTITY");
    }
    referenceOffset = start;
    return resolveEntity(name);
  };

  /**
   * Decodes text or an attribute value from `start` to `end` that contains
   * a reference at `nextAmp`. `normalize` replaces whitespace in the parts
   * between references, which keeps characters from references as they are.
   */
  const decode = (
    start: number,
    end: number,
    normalize: (start: number, end: number) => string,
  ): string => {
    let value = "";
    let last = start;
    let amp = nextAmp;
    while (amp < end) {
      const semicolon = svg.indexOf(";", amp + 1);
      if (semicolon === -1 || semicolon >= end) {
        fail("Unterminated reference", amp);
      }
      value += normalize(last, amp) + decodeReference(amp, semicolon);
      last = semicolon + 1;
      amp = find("&", last);
    }
    nextAmp = amp;
    return value + normalize(last, end);
  };

  const attributeValue = (start: number, end: number): string => {
    const value = svg.slice(start, end);
    return xml11 || nextTab < end || nextLf < end || nextCr < end
      ? value.replace(attributeWhitespace, " ")
      : value;
  };

  let children: SvgDocumentChild[] = [];
  let declaration: XmlDeclaration | undefined;
  // Children of the innermost open element, or of the document.
  let siblings: (SvgNode | SvgDocumentChild)[] = children;
  const stack: SvgElement[] = [];
  const elementStarts: SvgSourcePoint[] = [];
  let sawRoot = false;
  let closedRoot = false;
  let sawDoctype = false;

  // Namespace prefixes in scope. Scopes inherit through prototypes, so an
  // element that declares no namespaces shares the scope of its parent.
  let namespaces = Object.assign(Object.create(null) as object, {
    xml: XML_NAMESPACE,
    xmlns: XMLNS_NAMESPACE,
  }) as Record<string, string>;
  const namespaceStack: Record<string, string>[] = [];

  const append = (
    node: SvgNode | SvgDocumentChild,
    start: number,
    end: number,
  ): void => {
    if (positions) {
      node.position = { start: pointAt(start), end: pointAt(end) };
    }
    siblings.push(node);
  };

  let i = svg.charCodeAt(0) === 0xfeff ? 1 : 0;

  if (
    svg.startsWith("<?xml", i) &&
    (isWhitespace(svg.charCodeAt(i + 5)) || svg.charCodeAt(i + 5) === QUESTION)
  ) {
    const parsed = parseDeclaration(svg, i, fail);
    declaration = parsed.declaration;
    xml11 = declaration.version !== "1.0";
    if (xml11) {
      lineBreak = LINE_BREAK_11;
      attributeWhitespace = ATTRIBUTE_WHITESPACE_11;
    }
    i = parsed.end;
  }

  while (i < length) {
    if (nextLt < i) {
      nextLt = find("<", i);
    }

    // Text up to the next markup.
    if (nextLt > i) {
      const end = nextLt;
      if (stack.length === 0) {
        for (let j = i; j < end; j++) {
          if (!isWhitespace(svg.charCodeAt(j))) {
            fail("Text data outside of root element", j);
          }
        }
        append({ type: "text", value: raw(i, end) }, i, end);
      } else {
        if (nextCdataEnd < i) {
          nextCdataEnd = find("]]>", i);
        }
        if (nextCdataEnd < end) {
          fail('The string "]]>" is not allowed in text', nextCdataEnd);
        }
        if (nextAmp < i) {
          nextAmp = find("&", i);
        }
        append(
          {
            type: "text",
            value: nextAmp < end ? decode(i, end, raw) : raw(i, end),
          },
          i,
          end,
        );
      }
      i = end;
      continue;
    }

    const start = i;
    const c = svg.charCodeAt(i + 1);

    if (c === SLASH) {
      // End tag. Comparing the name in place avoids slicing it.
      const element = stack.at(-1);
      if (element === undefined) {
        return fail("Unexpected end tag", i + 2);
      }
      const { name } = element;
      let j = i + 2 + name.length;
      // The name must end here, so that `</gg>` does not close `<g>`.
      const after = svg.charCodeAt(j);
      if (
        !svg.startsWith(name, i + 2) ||
        after >= 0x80 ||
        (NAME_TABLE[after] ?? 0) !== 0
      ) {
        fail("Unexpected end tag", i + 2);
      }
      while (isWhitespace(svg.charCodeAt(j))) {
        j++;
      }
      if (svg.charCodeAt(j) !== GT) {
        fail("Expected > after the end tag name", j);
      }
      i = j + 1;

      stack.pop();
      // Arrays reserve room for more items as they grow; copying gives the
      // array an exact capacity, which saves memory in large trees where most
      // elements have few children.
      if (element.children.length > 0) {
        element.children = element.children.slice();
      }
      if (positions) {
        element.position = {
          start: elementStarts.pop() ?? pointAt(start),
          end: pointAt(i),
        };
      }
      namespaces = namespaceStack.pop() ?? namespaces;
      const parent = stack.at(-1);
      if (parent === undefined) {
        siblings = children;
        closedRoot = true;
      } else {
        siblings = parent.children;
      }
      continue;
    }

    if (c === BANG) {
      if (svg.startsWith("--", i + 2)) {
        const end = svg.indexOf("-->", i + 4);
        if (end === -1) {
          fail("Unterminated comment", i);
        }
        const value = raw(i + 4, end);
        if (value.includes("--") || value.endsWith("-")) {
          fail('The string "--" is not allowed in comments', i);
        }
        i = end + 3;
        append({ type: "comment", value }, start, i);
        continue;
      }

      if (svg.startsWith("[CDATA[", i + 2)) {
        if (stack.length === 0) {
          fail("CDATA section outside of root element", i);
        }
        const end = svg.indexOf("]]>", i + 9);
        if (end === -1) {
          fail("Unterminated CDATA section", i);
        }
        nextCdataEnd = end;
        const value = raw(i + 9, end);
        i = end + 3;
        append({ type: "cdata", value }, start, i);
        continue;
      }

      if (svg.startsWith("DOCTYPE", i + 2)) {
        if (sawDoctype || sawRoot) {
          fail("DOCTYPE must appear once, before the root element", i);
        }
        sawDoctype = true;
        const end = findDoctypeEnd(svg, i + 9, fail);
        const value = raw(i + 9, end).replace(LEADING_WHITESPACE, "");
        i = end + 1;
        append({ type: "doctype", value }, start, i);

        const declarations = parseEntityDeclarations(value, (message) =>
          fail(message, start),
        );
        if (declarations.size > 0) {
          resolveEntity = createEntityResolver(
            declarations,
            entityLimits,
            (message, code) => fail(message, referenceOffset, code),
          );
        }
        continue;
      }

      return fail("Malformed markup declaration", i);
    }

    if (c === QUESTION) {
      const targetEnd = scanName(svg, i + 2);
      if (targetEnd === i + 2) {
        fail("Processing instruction without a target", i + 2);
      }
      const target = svg.slice(i + 2, targetEnd);
      if (target.includes(":")) {
        fail("Colons are not allowed in processing instruction targets", i);
      }
      if (target.toLowerCase() === "xml") {
        fail("The XML declaration must be at the start of the document", i);
      }
      let j = targetEnd;
      if (!svg.startsWith("?>", j)) {
        if (!isWhitespace(svg.charCodeAt(j))) {
          fail("Disallowed character in processing instruction target", j);
        }
        while (isWhitespace(svg.charCodeAt(j))) {
          j++;
        }
      }
      const end = svg.indexOf("?>", j);
      if (end === -1) {
        fail("Unterminated processing instruction", i);
      }
      i = end + 2;
      append({ type: "instruction", target, value: raw(j, end) }, start, i);
      continue;
    }

    // Start tag.
    const nameEnd = scanName(svg, i + 1);
    if (nameEnd === i + 1) {
      fail("Disallowed character in tag name", i + 1);
    }
    if (closedRoot) {
      fail("Documents may contain only one root element", i);
    }
    if (stack.length >= maxDepth) {
      fail(
        `Elements are nested deeper than ${maxDepth} levels`,
        i,
        "MAX_DEPTH_EXCEEDED",
      );
    }
    const name = svg.slice(i + 1, nameEnd);
    // An attribute value must not contain "<", so the tag ends before the
    // next "<", which is also where the text after the tag ends.
    nextLt = find("<", nameEnd);

    const attributes: Record<string, string> = {};
    // Allocated only for the few elements that need namespace checks.
    let declarations: string[] | undefined;
    let prefixed: string[] | undefined;
    let selfClosing = false;
    let j = nameEnd;

    while (true) {
      let code = svg.charCodeAt(j);
      if (code === GT) {
        j++;
        break;
      }
      if (code === SLASH) {
        if (svg.charCodeAt(j + 1) !== GT) {
          fail("Expected > after / in tag", j + 1);
        }
        j += 2;
        selfClosing = true;
        break;
      }
      if (!isWhitespace(code)) {
        if (j >= length) {
          fail("Unexpected end of input in tag", j);
        }
        fail(
          scanName(svg, j) > j
            ? "No whitespace between attributes"
            : "Disallowed character in tag",
          j,
        );
      }
      do {
        code = svg.charCodeAt(++j);
      } while (isWhitespace(code));
      if (code === GT || code === SLASH) {
        continue;
      }

      const attributeEnd = scanName(svg, j);
      if (attributeEnd === j) {
        fail(
          j >= length
            ? "Unexpected end of input in tag"
            : "Disallowed character in attribute name",
          j,
        );
      }
      const attribute = svg.slice(j, attributeEnd);
      j = attributeEnd;
      while (isWhitespace(svg.charCodeAt(j))) {
        j++;
      }
      if (svg.charCodeAt(j) !== EQUAL) {
        fail("Attribute without value", j);
      }
      do {
        code = svg.charCodeAt(++j);
      } while (isWhitespace(code));
      if (code !== DQUOTE && code !== SQUOTE) {
        fail("Unquoted attribute value", j);
      }
      const valueStart = j + 1;
      const valueEnd = svg.indexOf(code === DQUOTE ? '"' : "'", valueStart);
      if (valueEnd === -1 || valueEnd > nextLt) {
        fail(
          valueEnd === -1
            ? "Unterminated attribute value"
            : 'The character "<" is not allowed in attribute values',
          valueEnd === -1 ? j : nextLt,
        );
      }
      j = valueEnd + 1;

      if (nextAmp < valueStart) {
        nextAmp = find("&", valueStart);
      }
      // Values are normalized only when they contain a tab or a line break.
      if (nextTab < valueStart) {
        nextTab = find("\t", valueStart);
      }
      if (nextLf < valueStart) {
        nextLf = find("\n", valueStart);
      }
      if (nextCr < valueStart) {
        nextCr = find("\r", valueStart);
      }
      const value =
        nextAmp < valueEnd
          ? decode(valueStart, valueEnd, attributeValue)
          : attributeValue(valueStart, valueEnd);

      if (Object.hasOwn(attributes, attribute)) {
        fail(`Duplicate attribute: ${attribute}`, valueStart);
      }
      if (attribute === "__proto__") {
        // Assignment would change the prototype instead.
        Object.defineProperty(attributes, attribute, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      } else {
        attributes[attribute] = value;
      }

      if (attribute.startsWith("xmlns")) {
        if (attribute.length === 5 || attribute.charCodeAt(5) === 0x3a) {
          (declarations ??= []).push(attribute);
        } else if (attribute.includes(":")) {
          (prefixed ??= []).push(attribute);
        }
      } else if (attribute.includes(":")) {
        (prefixed ??= []).push(attribute);
      }
    }

    // Namespace well-formedness, needed only for declarations and prefixes.
    let scope = namespaces;
    if (declarations !== undefined) {
      scope = Object.create(namespaces) as Record<string, string>;
      for (const attribute of declarations) {
        const uri = (attributes[attribute] ?? "").trim();
        const prefix =
          attribute.length === 5 ? "" : splitPrefix(attribute, start, fail)[1];
        checkNamespace(prefix, uri, xml11, (message) => fail(message, start));
        if (prefix !== "") {
          scope[prefix] = uri;
        }
      }
    }
    if (name.includes(":")) {
      const [prefix] = splitPrefix(name, start, fail);
      if (prefix === "xmlns") {
        fail('Elements may not have "xmlns" as prefix', start);
      }
      if (!scope[prefix]) {
        fail(
          `Unbound namespace prefix: ${JSON.stringify(prefix)}`,
          start,
          "UNDECLARED_PREFIX",
        );
      }
    }
    if (prefixed !== undefined) {
      const expanded = prefixed.length > 1 ? new Set<string>() : undefined;
      for (const attribute of prefixed) {
        const [prefix, local] = splitPrefix(attribute, start, fail);
        const uri = scope[prefix];
        if (!uri) {
          fail(
            `Unbound namespace prefix: ${JSON.stringify(prefix)}`,
            start,
            "UNDECLARED_PREFIX",
          );
        }
        if (expanded !== undefined) {
          const key = `{${uri}}${local}`;
          if (expanded.has(key)) {
            fail(`Duplicate attribute: ${key}`, start);
          }
          expanded.add(key);
        }
      }
    }

    const element: SvgElement = {
      type: "element",
      name,
      attributes,
      children: [],
    };
    siblings.push(element);
    sawRoot = true;
    i = j;

    if (selfClosing) {
      if (positions) {
        element.position = { start: pointAt(start), end: pointAt(i) };
      }
      if (stack.length === 0) {
        closedRoot = true;
      }
    } else {
      if (positions) {
        elementStarts.push(pointAt(start));
      }
      stack.push(element);
      namespaceStack.push(namespaces);
      namespaces = scope;
      siblings = element.children;
    }
  }

  const unclosed = stack.at(-1);
  if (unclosed !== undefined) {
    fail(`Unclosed tag: ${unclosed.name}`, length);
  }
  if (!sawRoot) {
    fail("Document must contain a root element", length, "MISSING_ROOT");
  }

  if (whitespace === "trim") {
    children = trimWhitespace(children);
  }

  return declaration === undefined
    ? { type: "document", children }
    : { type: "document", declaration, children };
}
