import { describe, expect, expectTypeOf, test } from "vitest";
import { getRoot, parse, stringify } from "./index";
import type { SvgDocument, SvgElement } from "./types";

describe("getRoot", () => {
  test("finds the root among document-level nodes without counting descendants", () => {
    const document = parse(
      '<?xml version="1.0"?>\n<!-- before --><?example value?><!DOCTYPE svg>\n<svg><g><path/></g></svg>\n<!-- after -->',
    );
    const root = getRoot(document);

    expectTypeOf(root).toEqualTypeOf<SvgElement>();
    expect(root.name).toBe("svg");
    expect(root.children).toHaveLength(1);
  });

  test("returns the original element so edits update the document", () => {
    const root: SvgElement = {
      type: "element",
      name: "svg",
      attributes: {},
      children: [],
    };
    const document: SvgDocument = { type: "document", children: [root] };

    expect(getRoot(document)).toBe(root);
    getRoot(document).attributes.fill = "currentColor";
    getRoot(document).children.push({ type: "text", value: "Hello" });

    expect(stringify(document)).toBe('<svg fill="currentColor">Hello</svg>');
  });

  test("accepts any root element name", () => {
    expect(
      getRoot(parse('<custom:root xmlns:custom="urn:example"/>')).name,
    ).toBe("custom:root");
  });

  test("rejects an empty document", () => {
    expect(() => getRoot({ type: "document", children: [] })).toThrow(
      TypeError,
    );
  });

  test("rejects a document with only non-element children", () => {
    expect(() =>
      getRoot({
        type: "document",
        children: [
          { type: "comment", value: " no root " },
          { type: "text", value: "\n" },
          { type: "doctype", value: "svg" },
          { type: "instruction", target: "example", value: "" },
        ],
      }),
    ).toThrow(TypeError);
  });

  test("rejects multiple root elements after editing a parsed document", () => {
    const document = parse("<svg/>");
    document.children.push({ type: "comment", value: " between roots " });
    document.children.push(getRoot(document));

    expect(() => getRoot(document)).toThrow(TypeError);
  });
});
