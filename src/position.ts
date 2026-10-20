import type { SvgSourcePoint } from "./types";

/**
 * Returns a function that computes the point of a character offset in
 * `source`. Offsets must not decrease between calls, so that each character
 * is scanned only once.
 */
export function createPointTracker(
  source: string,
): (offset: number) => SvgSourcePoint {
  let index = 0;
  let line = 1;
  let lineStart = 0;

  return (offset) => {
    for (; index < offset; index++) {
      const char = source.charCodeAt(index);
      // "\n", or "\r" not followed by "\n"
      if (
        char === 0x0a ||
        (char === 0x0d && source.charCodeAt(index + 1) !== 0x0a)
      ) {
        line++;
        lineStart = index + 1;
      }
    }
    return { line, column: offset - lineStart + 1, offset };
  };
}
