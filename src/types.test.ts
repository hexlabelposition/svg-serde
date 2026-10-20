import { describe, expect, expectTypeOf, test } from "vitest";
import type { SvgAttributes, SvgDocument, SvgElementName } from "./types";

const document = {
  type: "document",
  declaration: { version: "1.0", encoding: "UTF-8" },
  children: [
    {
      type: "doctype",
      value:
        'svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"',
    },
    { type: "text", value: "\n" },
    {
      type: "element",
      name: "svg",
      attributes: {
        xmlns: "http://www.w3.org/2000/svg",
        "xmlns:xlink": "http://www.w3.org/1999/xlink",
      },
      children: [
        { type: "comment", value: " icon " },
        {
          type: "instruction",
          target: "xml-stylesheet",
          value: 'href="style.css"',
        },
        {
          type: "element",
          name: "style",
          attributes: {},
          children: [{ type: "cdata", value: "a > b {}" }],
        },
        {
          type: "element",
          name: "use",
          attributes: { "xlink:href": "#icon" },
          children: [],
        },
      ],
    },
  ],
} satisfies SvgDocument;

describe("object model", () => {
  test("is plain JSON data", () => {
    expect(JSON.parse(JSON.stringify(document))).toEqual(document);
  });

  test("preserves attribute order", () => {
    const attributes: Record<string, string> = {
      y: "1",
      x: "2",
      "xlink:href": "#a",
      d: "M0 0",
    };
    expect(Object.keys(attributes)).toEqual(["y", "x", "xlink:href", "d"]);
  });
});

describe("names", () => {
  test("do not restrict element names", () => {
    expectTypeOf<"sodipodi:namedview">().toExtend<SvgElementName>();
    expectTypeOf<SvgElementName>().toExtend<string>();
  });

  test("do not restrict attribute keys", () => {
    const attributes: SvgAttributes = {
      fill: "red",
      "data-id": "1",
      "inkscape:label": "a",
    };
    attributes.stroke = "blue";
    delete attributes.fill;

    expectTypeOf(Object.entries(attributes)).toEqualTypeOf<
      [string, string][]
    >();
    expectTypeOf<SvgAttributes>().toExtend<Record<string, string>>();
    expectTypeOf<Record<string, string>>().toExtend<SvgAttributes>();
  });

  test("require string attribute values", () => {
    // @ts-expect-error Values must be strings.
    const known: SvgAttributes = { width: 10 };
    // @ts-expect-error Values must be strings.
    const unknown: SvgAttributes = { "data-width": 10 };
    expect([known, unknown]).toHaveLength(2);
  });
});
