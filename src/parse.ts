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
import { ENCODING, INVALID_CHAR, NAME, VERSION } from "./xml";

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

const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

const TAB = 0x09;
const LF = 0x0a;
const CR = 0x0d;
const SPACE = 0x20;
const BANG = 0x21;
const DQUOTE = 0x22;
const HASH = 0x23;
const SQUOTE = 0x27;
const SLASH = 0x2f;
const EQUAL = 0x3d;
const LT = 0x3c;
const GT = 0x3e;
const QUESTION = 0x3f;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const LOWER_X = 0x78;

/**
 * ASCII part of the XML `Name` production as a lookup table: bit 1 marks
 * name characters, bit 2 marks characters that can also start a name.
 * Names with other characters are checked against the full `NAME` pattern.
 */
const NAME_CHAR = 1;
const NAME_START_CHAR = 2;
const NAME_TABLE = new Uint8Array(128);
for (let c = 0; c < 128; c++) {
  if (
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x61 && c <= 0x7a) ||
    c === 0x5f ||
    c === 0x3a
  ) {
    NAME_TABLE[c] = NAME_CHAR | NAME_START_CHAR;
  } else if ((c >= 0x30 && c <= 0x39) || c === 0x2d || c === 0x2e) {
    NAME_TABLE[c] = NAME_CHAR;
  }
}

const LINE_BREAK = /\r\n?/g;
const LINE_BREAK_11 = /\r[\n\u0085]?|[\u0085\u2028]/g;
// Attribute value normalization: each line break, tab, or newline becomes a
// space, after line breaks are normalized.
const ATTRIBUTE_WHITESPACE = /\r\n?|[\t\n]/g;
const ATTRIBUTE_WHITESPACE_11 = /\r[\n\u0085]?|[\t\n\u0085\u2028]/g;
const LEADING_WHITESPACE = /^[ \t\n]+/;

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
  const elementStarts: SvgPoint[] = [];
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
        return fail("Unexpected close tag", i + 2);
      }
      const { name } = element;
      let j = i + 2 + name.length;
      const after = svg.charCodeAt(j);
      if (
        !svg.startsWith(name, i + 2) ||
        after >= 0x80 ||
        (NAME_TABLE[after] ?? 0) !== 0
      ) {
        fail("Unexpected close tag", i + 2);
      }
      while (isWhitespace(svg.charCodeAt(j))) {
        j++;
      }
      if (svg.charCodeAt(j) !== GT) {
        fail("Expected > at the end of the close tag", j);
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

function isWhitespace(c: number): boolean {
  return c === SPACE || c === LF || c === TAB || c === CR;
}

/**
 * The XML `Char` production: https://www.w3.org/TR/xml/#NT-Char
 */
function isXmlChar(c: number): boolean {
  return c >= 0x20
    ? c <= 0xd7ff || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000
    : c === TAB || c === LF || c === CR;
}

/**
 * Returns the end of the name starting at `start`, or `start` if no valid
 * name starts there.
 */
function scanName(source: string, start: number): number {
  const first = source.charCodeAt(start);
  if (first >= 0x80) {
    return scanUnicodeName(source, start);
  }
  // NaN at the end of the input reads as undefined.
  if (((NAME_TABLE[first] ?? 0) & NAME_START_CHAR) === 0) {
    return start;
  }
  for (let i = start + 1; ; i++) {
    const c = source.charCodeAt(i);
    if (c >= 0x80) {
      return scanUnicodeName(source, start);
    }
    if ((NAME_TABLE[c] ?? 0) === 0) {
      return i;
    }
  }
}

/**
 * Slow path of `scanName()` for names with non-ASCII characters.
 */
function scanUnicodeName(source: string, start: number): number {
  let i = start;
  while (i < source.length) {
    const c = source.charCodeAt(i);
    if (c < 0x80 && NAME_TABLE[c] === 0) {
      break;
    }
    i++;
  }
  return NAME.test(source.slice(start, i)) ? i : start;
}

/**
 * Splits a qualified name into prefix and local part.
 */
function splitPrefix(
  name: string,
  offset: number,
  fail: (message: string, offset: number) => never,
): [string, string] {
  const colon = name.indexOf(":");
  if (
    colon <= 0 ||
    colon === name.length - 1 ||
    name.includes(":", colon + 1)
  ) {
    fail(`Malformed name: ${name}`, offset);
  }
  return [name.slice(0, colon), name.slice(colon + 1)];
}

/**
 * Checks a namespace declaration as required by Namespaces in XML.
 */
function checkNamespace(
  prefix: string,
  uri: string,
  xml11: boolean,
  fail: (message: string) => never,
): void {
  if (prefix === "xml" && uri !== XML_NAMESPACE) {
    fail(`The xml prefix must be bound to ${XML_NAMESPACE}`);
  }
  if (prefix === "xmlns") {
    fail('The "xmlns" prefix must not be declared');
  }
  if (uri === XMLNS_NAMESPACE) {
    fail(`No prefix may be bound to ${XMLNS_NAMESPACE}`);
  }
  if (uri === XML_NAMESPACE && prefix !== "xml") {
    fail(`Only the xml prefix may be bound to ${XML_NAMESPACE}`);
  }
  if (prefix !== "" && uri === "" && !xml11) {
    fail(`Namespace prefix cannot be undeclared in XML 1.0: ${prefix}`);
  }
}

/**
 * Parses the XML declaration at `start` and returns it with the offset after
 * its end.
 */
function parseDeclaration(
  svg: string,
  start: number,
  fail: (message: string, offset: number) => never,
): { declaration: XmlDeclaration; end: number } {
  const declaration: XmlDeclaration = { version: "" };
  const names = ["version", "encoding", "standalone"];
  let expected = 0;
  let i = start + 5;

  while (true) {
    const whitespaceStart = i;
    while (isWhitespace(svg.charCodeAt(i))) {
      i++;
    }
    if (svg.startsWith("?>", i)) {
      break;
    }
    if (i === whitespaceStart) {
      fail("Whitespace required in XML declaration", i);
    }

    let nameEnd = i;
    while (nameEnd < svg.length) {
      const c = svg.charCodeAt(nameEnd);
      if (c === EQUAL || c === QUESTION || isWhitespace(c)) {
        break;
      }
      nameEnd++;
    }
    const name = svg.slice(i, nameEnd);
    const index = names.indexOf(name, expected);
    if (index === -1 || (expected === 0 && index !== 0)) {
      fail(
        expected === 0
          ? "XML declaration must start with version"
          : `Unexpected ${JSON.stringify(name)} in XML declaration`,
        i,
      );
    }
    expected = index + 1;

    i = nameEnd;
    while (isWhitespace(svg.charCodeAt(i))) {
      i++;
    }
    if (svg.charCodeAt(i) !== EQUAL) {
      fail("Value required in XML declaration", i);
    }
    i++;
    while (isWhitespace(svg.charCodeAt(i))) {
      i++;
    }
    const quote = svg.charAt(i);
    if (quote !== '"' && quote !== "'") {
      fail("XML declaration values must be quoted", i);
    }
    const valueEnd = svg.indexOf(quote, i + 1);
    if (valueEnd === -1) {
      fail("Unterminated XML declaration", start);
    }
    const value = svg.slice(i + 1, valueEnd);

    if (name === "version") {
      if (!VERSION.test(value)) {
        fail("Version number must match /^1\\.[0-9]+$/", i);
      }
      declaration.version = value;
    } else if (name === "encoding") {
      if (!ENCODING.test(value)) {
        fail("Encoding must match /^[A-Za-z][A-Za-z0-9._-]*$/", i);
      }
      declaration.encoding = value;
    } else {
      if (value !== "yes" && value !== "no") {
        fail('Standalone must be "yes" or "no"', i);
      }
      declaration.standalone = value;
    }
    i = valueEnd + 1;
  }

  if (expected === 0) {
    fail("XML declaration must contain a version", start);
  }
  return { declaration, end: i + 2 };
}

/**
 * Returns the offset of the `>` that ends a DOCTYPE whose content starts at
 * `start`, skipping quoted literals and the internal subset with the
 * comments and processing instructions in it.
 */
function findDoctypeEnd(
  svg: string,
  start: number,
  fail: (message: string, offset: number) => never,
): number {
  if (!isWhitespace(svg.charCodeAt(start))) {
    fail("Whitespace required after DOCTYPE", start);
  }
  let inSubset = false;
  let i = start;
  while (i < svg.length) {
    const c = svg.charCodeAt(i);
    if (c === DQUOTE || c === SQUOTE) {
      const end = svg.indexOf(c === DQUOTE ? '"' : "'", i + 1);
      if (end === -1) {
        break;
      }
      i = end + 1;
    } else if (inSubset) {
      if (c === CLOSE_BRACKET) {
        inSubset = false;
        i++;
      } else if (c === LT && svg.startsWith("<!--", i)) {
        const end = svg.indexOf("-->", i + 4);
        if (end === -1) {
          break;
        }
        i = end + 3;
      } else if (c === LT && svg.charCodeAt(i + 1) === QUESTION) {
        const end = svg.indexOf("?>", i + 2);
        if (end === -1) {
          break;
        }
        i = end + 2;
      } else {
        i++;
      }
    } else if (c === GT) {
      return i;
    } else {
      if (c === OPEN_BRACKET) {
        inSubset = true;
      }
      i++;
    }
  }
  return fail("Unterminated DOCTYPE", start - 9);
}
