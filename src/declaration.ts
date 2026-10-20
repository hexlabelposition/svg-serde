import { EQUAL, isWhitespace, QUESTION } from "./chars";
import type { XmlDeclaration } from "./types";
import { ENCODING, VERSION } from "./xml";

/**
 * Parses the XML declaration at `start` and returns it with the offset after
 * its end.
 */
export function parseDeclaration(
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
 * Writes an XML declaration, checking that its values are valid.
 */
export function stringifyDeclaration(declaration: XmlDeclaration): string {
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
