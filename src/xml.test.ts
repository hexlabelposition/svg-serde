import { describe, expect, test } from "vitest";
import { INVALID_CHAR } from "./xml";

describe("XML character validation", () => {
  test("matches the XML 1.0 Char production for every Unicode code point", () => {
    const mismatches: number[] = [];
    for (let codePoint = 0; codePoint <= 0x10ffff; codePoint++) {
      // XML 1.0, fifth edition, production [2]: https://www.w3.org/TR/xml/#charsets
      const allowed =
        codePoint === 0x9 ||
        codePoint === 0xa ||
        codePoint === 0xd ||
        (codePoint >= 0x20 && codePoint <= 0xd7ff) ||
        (codePoint >= 0xe000 && codePoint <= 0xfffd) ||
        (codePoint >= 0x10000 && codePoint <= 0x10ffff);

      if (INVALID_CHAR.test(String.fromCodePoint(codePoint)) !== !allowed) {
        mismatches.push(codePoint);
      }
    }
    expect(mismatches).toEqual([]);
  });

  test.each([
    ["\uD800x\uDC00", 0, "\uD800"],
    ["\uDC00\uD800", 0, "\uDC00"],
    ["\uD800\uD800\uDC00", 0, "\uD800"],
    ["\uD800\uDC00\uDC00", 2, "\uDC00"],
    ["\uD800\uDC00\uD800", 2, "\uD800"],
    ["\uD800\uDC00\u0000\uFFFF", 2, "\u0000"],
  ])("finds the first invalid character in %j", (value, offset, character) => {
    const match = INVALID_CHAR.exec(value);
    expect(match?.index).toBe(offset);
    expect(match?.[0]).toBe(character);
  });

  test("accepts XML whitespace, BMP text, and adjacent astral characters", () => {
    expect(
      INVALID_CHAR.test("\t\n\rПривет 日本語 \uD800\uDC00😀\uDBFF\uDFFF"),
    ).toBe(false);
  });
});
