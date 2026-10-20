import { CR, LF, TAB } from "./chars";

/**
 * XML `Name` production: https://www.w3.org/TR/xml/#NT-Name
 */
const NAME_START_CHARS =
  ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D" +
  "\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF" +
  "\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const NAME_CHARS = `${NAME_START_CHARS}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`;
export const NAME: RegExp = new RegExp(
  // XML allows combining characters U+0300 to U+036F in names.
  // eslint-disable-next-line no-misleading-character-class
  `^[${NAME_START_CHARS}][${NAME_CHARS}]*$`,
  "u",
);

/**
 * Characters outside the XML `Char` production: https://www.w3.org/TR/xml/#NT-Char
 */
// A positive class of forbidden code points lets engines skip ordinary XML
// text efficiently. Unicode mode matches valid surrogate pairs as a single
// astral code point, so the surrogate range here rejects only unpaired ones.
export const INVALID_CHAR: RegExp =
  // eslint-disable-next-line no-control-regex -- XML 1.0 forbids these controls.
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/u;

/**
 * XML `VersionNum` production: https://www.w3.org/TR/xml/#NT-VersionNum
 */
export const VERSION: RegExp = /^1\.[0-9]+$/;

/**
 * XML `EncName` production: https://www.w3.org/TR/xml/#NT-EncName
 */
export const ENCODING: RegExp = /^[A-Za-z][A-Za-z0-9._-]*$/;

/**
 * Body of an XML `CharRef` between `&` and `;`:
 * https://www.w3.org/TR/xml/#NT-CharRef
 */
export const CHAR_REFERENCE: RegExp = /^#(?:x[0-9a-fA-F]+|[0-9]+)$/;

/**
 * Entities predefined by XML and their replacement text:
 * https://www.w3.org/TR/xml/#sec-predefined-ent
 */
export const PREDEFINED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ["lt", "<"],
  ["gt", ">"],
  ["amp", "&"],
  ["apos", "'"],
  ["quot", '"'],
]);

/**
 * ASCII part of the XML `Name` production as a lookup table: bit 1 marks
 * name characters, bit 2 marks characters that can also start a name.
 * Names with other characters are checked against the full `NAME` pattern.
 */
const NAME_CHAR = 1;
const NAME_START_CHAR = 2;
export const NAME_TABLE: Uint8Array = new Uint8Array(128);
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

/**
 * The XML `Char` production: https://www.w3.org/TR/xml/#NT-Char
 */
export function isXmlChar(c: number): boolean {
  return c >= 0x20
    ? c <= 0xd7ff || (c >= 0xe000 && c <= 0xfffd) || c >= 0x10000
    : c === TAB || c === LF || c === CR;
}

/**
 * Returns the end of the name starting at `start`, or `start` if no valid
 * name starts there.
 */
export function scanName(source: string, start: number): number {
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
 * Converts a character reference such as `#38` or `#x26` to its character.
 */
export function charFromReference(
  reference: string,
  fail: (message: string) => never,
): string {
  const codePoint =
    reference.charAt(1) === "x"
      ? Number.parseInt(reference.slice(2), 16)
      : Number.parseInt(reference.slice(1), 10);

  if (codePoint > 0x10ffff) {
    fail("Malformed character reference");
  }

  const char = String.fromCodePoint(codePoint);
  if (INVALID_CHAR.test(char)) {
    fail("Malformed character reference");
  }
  return char;
}
