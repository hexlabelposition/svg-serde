/**
 * Character codes compared against `charCodeAt()` results.
 */
export const TAB = 0x09;
export const LF = 0x0a;
export const CR = 0x0d;
export const SPACE = 0x20;
export const BANG = 0x21;
export const DQUOTE = 0x22;
export const HASH = 0x23;
export const SQUOTE = 0x27;
export const SLASH = 0x2f;
export const EQUAL = 0x3d;
export const LT = 0x3c;
export const GT = 0x3e;
export const QUESTION = 0x3f;
export const OPEN_BRACKET = 0x5b;
export const CLOSE_BRACKET = 0x5d;
export const LOWER_X = 0x78;

/**
 * The XML `S` production: https://www.w3.org/TR/xml/#NT-S
 */
export function isWhitespace(c: number): boolean {
  return c === SPACE || c === LF || c === TAB || c === CR;
}
