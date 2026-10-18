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
export const INVALID_CHAR: RegExp = new RegExp(
  "[^\\t\\n\\r\\u0020-\\uD7FF\\uE000-\\uFFFD\\u{10000}-\\u{10FFFF}]",
  "u",
);
