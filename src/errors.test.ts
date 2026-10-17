import { describe, expect, test } from "vitest";
import { SvgParseError } from "./errors";

describe("SvgParseError", () => {
  test("exposes code and position", () => {
    const error = new SvgParseError("Unclosed tag", {
      code: "MALFORMED_XML",
      line: 3,
      column: 7,
      offset: 42,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(SvgParseError);
    expect(error.name).toBe("SvgParseError");
    expect(error.message).toBe("Unclosed tag (line 3, column 7)");
    expect(error.code).toBe("MALFORMED_XML");
    expect(error.line).toBe(3);
    expect(error.column).toBe(7);
    expect(error.offset).toBe(42);
    expect(error.cause).toBeUndefined();
  });

  test("keeps the original error as cause", () => {
    const cause = new Error("parser failure");
    const error = new SvgParseError("Malformed XML", {
      code: "MALFORMED_XML",
      line: 1,
      column: 1,
      offset: 0,
      cause,
    });

    expect(error.cause).toBe(cause);
  });
});
