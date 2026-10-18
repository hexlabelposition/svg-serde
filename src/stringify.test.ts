import { describe, expect, test } from "vitest";
import { parse } from "./parse";
import { stringify } from "./stringify";
import type {
  StringifyOptions,
  SvgDocument,
  SvgDocumentChild,
  SvgNode,
} from "./types";

function svg(...children: SvgNode[]): SvgDocument {
  return {
    type: "document",
    children: [{ type: "element", name: "svg", attributes: {}, children }],
  };
}

function doc(...children: SvgDocumentChild[]): SvgDocument {
  return { type: "document", children };
}

const root: SvgDocumentChild = {
  type: "element",
  name: "svg",
  attributes: {},
  children: [],
};

describe("stringify", () => {
  describe("elements", () => {
    test("writes elements without children as self-closing", () => {
      expect(stringify(svg())).toBe("<svg/>");
    });

    test("writes nested elements in order", () => {
      const document = svg({
        type: "element",
        name: "g",
        attributes: {},
        children: [
          { type: "element", name: "rect", attributes: {}, children: [] },
          { type: "element", name: "circle", attributes: {}, children: [] },
        ],
      });
      expect(stringify(document)).toBe("<svg><g><rect/><circle/></g></svg>");
    });

    test("keeps names as written, including prefixes and casing", () => {
      const document = svg({
        type: "element",
        name: "sodipodi:namedview",
        attributes: {},
        children: [
          {
            type: "element",
            name: "linearGradient",
            attributes: {},
            children: [],
          },
        ],
      });
      expect(stringify(document)).toBe(
        "<svg><sodipodi:namedview><linearGradient/></sodipodi:namedview></svg>",
      );
    });

    test.each(["", "1rect", "my rect", "a>b", "-x"])(
      "rejects invalid element name %j",
      (name) => {
        expect(() =>
          stringify(
            svg({ type: "element", name, attributes: {}, children: [] }),
          ),
        ).toThrow(TypeError);
      },
    );
  });

  describe("attributes", () => {
    test("writes attributes in object key order with double quotes", () => {
      const document: SvgDocument = {
        type: "document",
        children: [
          {
            type: "element",
            name: "svg",
            attributes: {
              xmlns: "http://www.w3.org/2000/svg",
              "xmlns:xlink": "http://www.w3.org/1999/xlink",
              width: "10",
              height: "10",
            },
            children: [
              {
                type: "element",
                name: "use",
                attributes: { "xlink:href": "#a", "data-id": "1" },
                children: [],
              },
            ],
          },
        ],
      };
      expect(stringify(document)).toBe(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="10" height="10">' +
          '<use xlink:href="#a" data-id="1"/></svg>',
      );
    });

    test("writes empty values", () => {
      const document = svg({
        type: "element",
        name: "g",
        attributes: { class: "" },
        children: [],
      });
      expect(stringify(document)).toBe('<svg><g class=""/></svg>');
    });

    test("escapes special characters", () => {
      const document = svg({
        type: "element",
        name: "text",
        attributes: { title: `a & b < c > d "e" 'f'` },
        children: [],
      });
      expect(stringify(document)).toBe(
        `<svg><text title="a &amp; b &lt; c &gt; d &quot;e&quot; 'f'"/></svg>`,
      );
    });

    test("escapes whitespace that parsers would normalize", () => {
      const document = svg({
        type: "element",
        name: "path",
        attributes: { d: "M0 0\n\tL1 1\r\n" },
        children: [],
      });
      expect(stringify(document)).toBe(
        '<svg><path d="M0 0&#10;&#9;L1 1&#13;&#10;"/></svg>',
      );
    });

    test("rejects invalid attribute names", () => {
      const document = svg({
        type: "element",
        name: "g",
        attributes: { "a b": "1" },
        children: [],
      });
      expect(() => stringify(document)).toThrow(TypeError);
    });
  });

  describe("text", () => {
    test("writes text exactly as stored", () => {
      const document = svg({
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
      });
      expect(stringify(document)).toBe(
        "<svg><text>  Hello,\n  <tspan>world</tspan>!</text></svg>",
      );
    });

    test("escapes special characters", () => {
      expect(stringify(svg({ type: "text", value: `a & b < c > d "e"` }))).toBe(
        `<svg>a &amp; b &lt; c &gt; d "e"</svg>`,
      );
    });

    test("escapes carriage returns", () => {
      expect(stringify(svg({ type: "text", value: "a\r\nb" }))).toBe(
        "<svg>a&#13;\nb</svg>",
      );
    });

    test("escapes ]]> through >", () => {
      expect(stringify(svg({ type: "text", value: "]]>" }))).toBe(
        "<svg>]]&gt;</svg>",
      );
    });

    test("keeps characters outside the BMP", () => {
      expect(stringify(svg({ type: "text", value: "😀" }))).toBe(
        "<svg>😀</svg>",
      );
    });

    test.each(["\u0000", "\u0008", "\uFFFE", "\uD800"])(
      "rejects invalid character %j",
      (value) => {
        expect(() => stringify(svg({ type: "text", value }))).toThrow(
          TypeError,
        );
      },
    );
  });

  describe("CDATA", () => {
    test("writes content without escaping", () => {
      expect(stringify(svg({ type: "cdata", value: "a > b && c < d" }))).toBe(
        "<svg><![CDATA[a > b && c < d]]></svg>",
      );
    });

    test("splits sections around ]]>", () => {
      expect(stringify(svg({ type: "cdata", value: "a]]>b" }))).toBe(
        "<svg><![CDATA[a]]]]><![CDATA[>b]]></svg>",
      );
    });
  });

  describe("comments", () => {
    test("writes comments", () => {
      expect(stringify(svg({ type: "comment", value: " icon " }))).toBe(
        "<svg><!-- icon --></svg>",
      );
    });

    test.each(["a--b", "a-", "--"])("rejects %j", (value) => {
      expect(() => stringify(svg({ type: "comment", value }))).toThrow(
        TypeError,
      );
    });
  });

  describe("processing instructions", () => {
    test("writes target and value", () => {
      expect(
        stringify(svg({ type: "instruction", target: "pi", value: 'a="1"' })),
      ).toBe('<svg><?pi a="1"?></svg>');
    });

    test("writes an empty value without a space", () => {
      expect(
        stringify(svg({ type: "instruction", target: "pi", value: "" })),
      ).toBe("<svg><?pi?></svg>");
    });

    test.each(["xml", "XML", "1pi", ""])("rejects target %j", (target) => {
      expect(() =>
        stringify(svg({ type: "instruction", target, value: "" })),
      ).toThrow(TypeError);
    });

    test("rejects values containing ?>", () => {
      expect(() =>
        stringify(svg({ type: "instruction", target: "pi", value: "a?>b" })),
      ).toThrow(TypeError);
    });
  });

  describe("document", () => {
    test("writes the XML declaration", () => {
      const document: SvgDocument = {
        type: "document",
        declaration: { version: "1.0", encoding: "UTF-8", standalone: "no" },
        children: [{ type: "text", value: "\n" }, root],
      };
      expect(stringify(document)).toBe(
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<svg/>',
      );
    });

    test("writes a minimal XML declaration", () => {
      const document: SvgDocument = {
        type: "document",
        declaration: { version: "1.0" },
        children: [root],
      };
      expect(stringify(document)).toBe('<?xml version="1.0"?><svg/>');
    });

    test.each([
      { version: "2.0" },
      { version: "1.0", encoding: "UTF 8" },
      { version: "1.0", standalone: "maybe" },
    ])("rejects invalid declaration %j", (declaration) => {
      const document = {
        type: "document",
        declaration,
        children: [root],
      } as SvgDocument;
      expect(() => stringify(document)).toThrow(TypeError);
    });

    test("writes top-level nodes in order", () => {
      const document = doc(
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
        root,
        { type: "comment", value: " after " },
        { type: "text", value: "\n" },
      );
      expect(stringify(document)).toBe(
        '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n' +
          '<?xml-stylesheet href="style.css"?><!-- before --><svg/><!-- after -->\n',
      );
    });

    test("writes a DOCTYPE with an internal subset as is", () => {
      const value = 'svg [ <!ENTITY ns_svg "http://www.w3.org/2000/svg"> ]';
      expect(stringify(doc({ type: "doctype", value }, root))).toBe(
        `<!DOCTYPE ${value}><svg/>`,
      );
    });

    test("rejects a document without a root element", () => {
      expect(() => stringify(doc({ type: "comment", value: "" }))).toThrow(
        TypeError,
      );
    });

    test("rejects a document with several root elements", () => {
      expect(() => stringify(doc(root, root))).toThrow(TypeError);
    });

    test("rejects non-whitespace text outside the root element", () => {
      expect(() => stringify(doc({ type: "text", value: "x" }, root))).toThrow(
        TypeError,
      );
    });

    test("rejects a DOCTYPE after the root element", () => {
      expect(() =>
        stringify(doc(root, { type: "doctype", value: "svg" })),
      ).toThrow(TypeError);
    });

    test("rejects several DOCTYPEs", () => {
      const doctype: SvgDocumentChild = { type: "doctype", value: "svg" };
      expect(() => stringify(doc(doctype, doctype, root))).toThrow(TypeError);
    });

    test("rejects unknown node types", () => {
      const node = { type: "unknown" } as unknown as SvgNode;
      expect(() => stringify(svg(node))).toThrow("Unknown node type");
    });

    test("does not modify the document", () => {
      const document = svg({ type: "text", value: "a & b" });
      const copy: unknown = JSON.parse(JSON.stringify(document));
      stringify(document);
      expect(document).toEqual(copy);
    });
  });

  describe("pretty", () => {
    function pretty(source: string, options: StringifyOptions = {}): string {
      return stringify(parse(source), { pretty: true, ...options });
    }

    test("indents element-only content", () => {
      expect(pretty('<svg><g id="a"><rect/><circle/></g><path/></svg>')).toBe(
        [
          "<svg>",
          '  <g id="a">',
          "    <rect/>",
          "    <circle/>",
          "  </g>",
          "  <path/>",
          "</svg>",
        ].join("\n"),
      );
    });

    test("replaces existing whitespace between elements", () => {
      expect(pretty("<svg>\n\t<g>   <rect/>\n</g>\n\n</svg>")).toBe(
        "<svg>\n  <g>\n    <rect/>\n  </g>\n</svg>",
      );
    });

    test("writes elements with only whitespace as self-closing", () => {
      expect(pretty("<svg><g>\n  </g></svg>")).toBe("<svg>\n  <g/>\n</svg>");
    });

    test("puts comments and processing instructions on their own lines", () => {
      expect(pretty("<svg><!-- a --><?pi b?><rect/></svg>")).toBe(
        "<svg>\n  <!-- a -->\n  <?pi b?>\n  <rect/>\n</svg>",
      );
    });

    test("uses the indent option", () => {
      expect(pretty("<svg><g><rect/></g></svg>", { indent: 4 })).toBe(
        "<svg>\n    <g>\n        <rect/>\n    </g>\n</svg>",
      );
      expect(pretty("<svg><g><rect/></g></svg>", { indent: 0 })).toBe(
        "<svg>\n<g>\n<rect/>\n</g>\n</svg>",
      );
    });

    test("ignores indent without pretty", () => {
      const document = parse("<svg> <rect/> </svg>");
      expect(stringify(document, { indent: 4 })).toBe("<svg> <rect/> </svg>");
    });

    test.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      "rejects indent %d",
      (indent) => {
        expect(() => pretty("<svg/>", { indent })).toThrow(RangeError);
      },
    );

    test("puts top-level nodes on separate lines", () => {
      const source =
        '<?xml version="1.0"?>\n<!-- a -->\n\n<!DOCTYPE svg>  <svg><rect/></svg>\n<!-- b -->\n';
      expect(pretty(source)).toBe(
        [
          '<?xml version="1.0"?>',
          "<!-- a -->",
          "<!DOCTYPE svg>",
          "<svg>",
          "  <rect/>",
          "</svg>",
          "<!-- b -->",
        ].join("\n"),
      );
    });

    test("keeps mixed content and its descendants unchanged", () => {
      const source =
        "<svg><foreignObject><p>Hello <b> <i>world</i> </b></p></foreignObject></svg>";
      expect(pretty(source)).toBe(
        "<svg>\n  <foreignObject>\n    <p>Hello <b> <i>world</i> </b></p>\n  </foreignObject>\n</svg>",
      );
    });

    test.each([
      "text",
      "tspan",
      "textPath",
      "style",
      "script",
      "title",
      "desc",
    ])("keeps content of <%s> unchanged", (name) => {
      expect(pretty(`<svg><${name}> <g> <a/> </g> </${name}></svg>`)).toBe(
        `<svg>\n  <${name}> <g> <a/> </g> </${name}>\n</svg>`,
      );
    });

    test('keeps content with xml:space="preserve" unchanged', () => {
      const source =
        '<svg><g xml:space="preserve"> <g> <rect/> </g> </g></svg>';
      expect(pretty(source)).toBe(
        '<svg>\n  <g xml:space="preserve"> <g> <rect/> </g> </g>\n</svg>',
      );
    });

    test("keeps elements with CDATA unchanged", () => {
      expect(pretty("<svg><g> <![CDATA[a]]> </g></svg>")).toBe(
        "<svg>\n  <g> <![CDATA[a]]> </g>\n</svg>",
      );
    });
  });
});
