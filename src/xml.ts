/**
 * XML `Name` production: https://www.w3.org/TR/xml/#NT-Name
 */
const NAME_START_CHARS =
  ":A-Z_a-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u02FF\\u0370-\\u037D" +
  "\\u037F-\\u1FFF\\u200C-\\u200D\\u2070-\\u218F\\u2C00-\\u2FEF" +
  "\\u3001-\\uD7FF\\uF900-\\uFDCF\\uFDF0-\\uFFFD\\u{10000}-\\u{EFFFF}";
const NAME_CHARS = `${NAME_START_CHARS}\\-.0-9\\u00B7\\u0300-\\u036F\\u203F-\\u2040`;
export const NAME: RegExp = new RegExp(
  // Combining characters U+0300 to U+036F are allowed in names by design.
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
