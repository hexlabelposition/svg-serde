import { describe, expect, test } from "vitest";
import { SvgParseError } from "./errors";
import { parse } from "./parse";
import { stringify } from "./stringify";
import type { SvgElement } from "./types";

function root(svg: string): SvgElement {
  const element = parse(svg).children.find((child) => child.type === "element");
  if (element === undefined) {
    throw new Error("No root element");
  }
  return element;
}

function parseError(svg: string, options = {}): SvgParseError {
  try {
    parse(svg, options);
  } catch (error) {
    if (error instanceof SvgParseError) {
      return error;
    }
    throw error;
  }
  throw new Error("Expected parse() to throw");
}

describe("parse", () => {
  describe("elements", () => {
    test("parses a self-closing root element", () => {
      expect(parse("<svg/>")).toEqual({
        type: "document",
        children: [
          { type: "element", name: "svg", attributes: {}, children: [] },
        ],
      });
    });

    test("parses nested elements in order", () => {
      expect(
        root("<svg><g><rect/><circle></circle></g></svg>").children,
      ).toEqual([
        {
          type: "element",
          name: "g",
          attributes: {},
          children: [
            { type: "element", name: "rect", attributes: {}, children: [] },
            { type: "element", name: "circle", attributes: {}, children: [] },
          ],
        },
      ]);
    });

    test("keeps names as written, including prefixes and casing", () => {
      const svg =
        '<svg xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd">' +
        "<sodipodi:namedview/><linearGradient/></svg>";
      expect(
        root(svg).children.map(
          (child) => child.type === "element" && child.name,
        ),
      ).toEqual(["sodipodi:namedview", "linearGradient"]);
    });
  });

  describe("attributes", () => {
    test("keeps names, values, and source order", () => {
      const svg =
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
        'viewBox=\'0 0 10 10\' data-id="1" style="--color: red" xlink:href="#a"/>';
      const { attributes } = root(svg);
      expect(attributes).toEqual({
        xmlns: "http://www.w3.org/2000/svg",
        "xmlns:xlink": "http://www.w3.org/1999/xlink",
        viewBox: "0 0 10 10",
        "data-id": "1",
        style: "--color: red",
        "xlink:href": "#a",
      });
      expect(Object.keys(attributes)).toEqual([
        "xmlns",
        "xmlns:xlink",
        "viewBox",
        "data-id",
        "style",
        "xlink:href",
      ]);
    });

    test("decodes character and entity references", () => {
      expect(
        root('<svg a="&amp;&lt;&gt;&quot;&apos;&#65;&#x42;&#10;"/>').attributes,
      ).toEqual({
        a: "&<>\"'AB\n",
      });
    });

    test("keeps string values without interpretation", () => {
      expect(
        root('<svg width="10" height="1e2px" fill="url(#g)"/>').attributes,
      ).toEqual({
        width: "10",
        height: "1e2px",
        fill: "url(#g)",
      });
    });
  });

  describe("text", () => {
    test("keeps whitespace and mixed content", () => {
      expect(
        root("<svg><text>  Hello,\n  <tspan>world</tspan>!</text></svg>")
          .children,
      ).toEqual([
        {
          type: "element",
          name: "text",
          attributes: {},
          children: [
            { type: "text", value: "  Hello,\n  " },
            {
              type: "element",
              name: "tspan",
              attributes: {},
              children: [{ type: "text", value: "world" }],
            },
            { type: "text", value: "!" },
          ],
        },
      ]);
    });

    test("keeps whitespace-only text between elements", () => {
      expect(root("<svg>\n  <g/>\n</svg>").children).toEqual([
        { type: "text", value: "\n  " },
        { type: "element", name: "g", attributes: {}, children: [] },
        { type: "text", value: "\n" },
      ]);
    });

    test("decodes character and entity references", () => {
      expect(root("<svg>a &amp; b &lt; c &#x1F600;</svg>").children).toEqual([
        { type: "text", value: "a & b < c 😀" },
      ]);
    });

    test("normalizes line breaks", () => {
      expect(root("<svg>a\r\nb\rc</svg>").children).toEqual([
        { type: "text", value: "a\nb\nc" },
      ]);
    });
  });

  describe("other nodes", () => {
    test("parses CDATA sections", () => {
      expect(
        root("<svg><style><![CDATA[a > b && c]]></style></svg>").children,
      ).toEqual([
        {
          type: "element",
          name: "style",
          attributes: {},
          children: [{ type: "cdata", value: "a > b && c" }],
        },
      ]);
    });

    test("parses comments", () => {
      expect(root("<svg><!-- icon --></svg>").children).toEqual([
        { type: "comment", value: " icon " },
      ]);
    });

    test("parses processing instructions", () => {
      expect(root('<svg><?pi   a="1" ?><?empty?></svg>').children).toEqual([
        { type: "instruction", target: "pi", value: 'a="1" ' },
        { type: "instruction", target: "empty", value: "" },
      ]);
    });
  });

  describe("document", () => {
    test("parses the XML declaration", () => {
      expect(
        parse('<?xml version="1.0" encoding="UTF-8" standalone="no"?><svg/>')
          .declaration,
      ).toEqual({
        version: "1.0",
        encoding: "UTF-8",
        standalone: "no",
      });
    });

    test("omits missing declaration fields", () => {
      const { declaration } = parse('<?xml version="1.0"?><svg/>');
      expect(declaration).toEqual({ version: "1.0" });
      expect(Object.keys(declaration ?? {})).toEqual(["version"]);
    });

    test("omits the declaration when the source has none", () => {
      expect("declaration" in parse("<svg/>")).toBe(false);
    });

    test("keeps top-level nodes in order", () => {
      const svg =
        '<?xml version="1.0"?>\n' +
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
        '<?xml-stylesheet href="style.css"?><!-- before --><svg/><!-- after -->\n';
      expect(parse(svg).children).toEqual([
        { type: "text", value: "\n" },
        {
          type: "doctype",
          value:
            'svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"',
        },
        { type: "text", value: "\n" },
        {
          type: "instruction",
          target: "xml-stylesheet",
          value: 'href="style.css"',
        },
        { type: "comment", value: " before " },
        { type: "element", name: "svg", attributes: {}, children: [] },
        { type: "comment", value: " after " },
        { type: "text", value: "\n" },
      ]);
    });

    test("ignores a byte order mark", () => {
      expect(parse("\uFEFF<svg/>").children).toHaveLength(1);
    });

    test("returns plain JSON data", () => {
      const document = parse(
        '<?xml version="1.0"?><svg a="1"><!--c--><![CDATA[x]]>t</svg>',
      );
      expect(JSON.parse(JSON.stringify(document))).toEqual(document);
    });
  });

  describe("errors", () => {
    test.each([
      ["<svg>", "MALFORMED_XML"],
      ["<svg><g></svg>", "MALFORMED_XML"],
      ['<svg a="1/>', "MALFORMED_XML"],
      ['<svg a="1" a="2"/>', "MALFORMED_XML"],
      ["<svg/><svg/>", "MALFORMED_XML"],
      ["text<svg/>", "MALFORMED_XML"],
      ["<svg>&#0;</svg>", "MALFORMED_XML"],
      ["", "MISSING_ROOT"],
      ["<!-- only -->", "MISSING_ROOT"],
      ["<svg><a:b/></svg>", "UNDECLARED_PREFIX"],
      ['<svg a:b="1"/>', "UNDECLARED_PREFIX"],
      ["<svg>&nbsp;</svg>", "UNDEFINED_ENTITY"],
    ])("rejects %j with %s", (svg, code) => {
      expect(parseError(svg).code).toBe(code);
    });

    test("reports the position", () => {
      const error = parseError("<svg>\n  <g>\n</svg>");
      expect(error).toBeInstanceOf(SvgParseError);
      expect(error.line).toBe(3);
      expect(error.column).toBeGreaterThan(1);
      expect(error.offset).toBeGreaterThan(10);
      expect(error.message).toMatch(
        /^Unexpected close tag \(line 3, column \d+\)$/,
      );
      expect(error.cause).toBeInstanceOf(Error);
    });
  });

  describe("limits", () => {
    test("rejects input longer than maxInputLength", () => {
      const error = parseError("<svg/>", { maxInputLength: 5 });
      expect(error.code).toBe("MAX_INPUT_LENGTH_EXCEEDED");
      expect(error.offset).toBe(0);
    });

    test("accepts input of exactly maxInputLength", () => {
      expect(() => parse("<svg/>", { maxInputLength: 6 })).not.toThrow();
    });

    test("rejects elements nested deeper than maxDepth", () => {
      const error = parseError("<svg><g><g/></g></svg>", { maxDepth: 2 });
      expect(error.code).toBe("MAX_DEPTH_EXCEEDED");
      expect(error.line).toBe(1);
    });

    test("accepts elements nested exactly maxDepth deep", () => {
      expect(() => parse("<svg><g/></svg>", { maxDepth: 2 })).not.toThrow();
    });

    test("limits depth by default", () => {
      const svg = "<g>".repeat(5000) + "</g>".repeat(5000);
      expect(parseError(svg).code).toBe("MAX_DEPTH_EXCEEDED");
    });
  });
});

describe("round trip", () => {
  const samples = {
    minimal: "<svg/>",
    icon:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">\n' +
      '  <path d="M12 2L2 7l10 5 10-5-10-5z"/>\n' +
      '  <circle cx="12" cy="12" r="3"/>\n' +
      "</svg>\n",
    inkscape:
      '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n' +
      "<!-- Created with Inkscape (http://www.inkscape.org/) -->\n" +
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape"\n' +
      '   xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" width="210mm" height="297mm">\n' +
      '  <sodipodi:namedview id="base" inkscape:zoom="0.35"/>\n' +
      '  <g inkscape:label="Layer 1" inkscape:groupmode="layer" id="layer1">\n' +
      '    <rect style="fill:#ff0000;stroke-width:0.26" width="50" height="40" x="10" y="20"/>\n' +
      "  </g>\n" +
      "</svg>\n",
    gradients:
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">' +
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient>' +
      '<clipPath id="c"><rect width="10" height="10"/></clipPath>' +
      '<mask id="m"><circle r="5"/></mask>' +
      '<filter id="f"><feGaussianBlur stdDeviation="2"/></filter></defs>' +
      '<use xlink:href="#c" fill="url(#g)" mask="url(#m)" filter="url(#f)"/></svg>',
    text:
      '<svg xml:space="preserve"><text x="0" y="10">  Hello,\n  <tspan font-weight="bold">world</tspan> &amp; &lt;everyone&gt;!</text>' +
      "<title>Tom &amp; Jerry</title></svg>",
    style:
      '<svg><style><![CDATA[\n  .a > .b { fill: red; }\n  .c::after { content: "]]]]><![CDATA[>"; }\n]]></style>' +
      '<script type="text/javascript"><![CDATA[if (a < b && c) {}]]></script></svg>',
    escapes:
      '<svg data-a="&quot;quoted&quot; &amp; &lt;tag&gt;" data-b="line&#10;break&#9;tab&#13;" data-c=\'single "double"\'>' +
      "a&#13;b &#x1F600; ]]&gt;</svg>",
    prolog:
      '<?xml version="1.0"?>\n' +
      '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
      '<?xml-stylesheet type="text/css" href="style.css"?>\n' +
      "<!-- before -->\n<svg><?pi value?><!----></svg>\n<!-- after -->",
  };

  test.each(Object.entries(samples))("%s", (_name, svg) => {
    const document = parse(svg);
    expect(parse(stringify(document))).toEqual(document);
  });

  test("stringify output is stable", () => {
    for (const svg of Object.values(samples)) {
      const once = stringify(parse(svg));
      expect(stringify(parse(once))).toBe(once);
    }
  });
});
