import { describe, expect, test } from "vitest";
import { SvgParseError } from "./errors";
import { parse } from "./parse";
import { stringify } from "./stringify";
import type { ParseOptions, SvgElement } from "./types";

function withSubset(subset: string, body: string): string {
  return `<!DOCTYPE svg [${subset}]>${body}`;
}

function root(svg: string, options?: ParseOptions): SvgElement {
  const element = parse(svg, options).children.find(
    (child) => child.type === "element",
  );
  if (element === undefined) {
    throw new Error("No root element");
  }
  return element;
}

function parseError(svg: string, options: ParseOptions = {}): SvgParseError {
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

const illustrator =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  "<!-- Generator: Adobe Illustrator 16.0.0, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->\n" +
  '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n' +
  '\t<!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">\n' +
  '\t<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">\n' +
  '\t<!ENTITY ns_svg "http://www.w3.org/2000/svg">\n' +
  '\t<!ENTITY ns_xlink "http://www.w3.org/1999/xlink">\n' +
  "]>\n" +
  '<svg version="1.1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" xmlns="&ns_svg;" xmlns:xlink="&ns_xlink;"\n' +
  '\t x="0px" y="0px" width="100px" height="100px" xml:space="preserve">\n' +
  '<g i:extraneous="self">\n' +
  '\t<rect x="10" y="10" fill="#ED1C24" width="80" height="80"/>\n' +
  "</g>\n" +
  "</svg>\n";

describe("internal entities", () => {
  test("expands entities in files exported from Adobe Illustrator", () => {
    expect(root(illustrator).attributes).toMatchObject({
      "xmlns:x": "http://ns.adobe.com/Extensibility/1.0/",
      "xmlns:i": "http://ns.adobe.com/AdobeIllustrator/10.0/",
      xmlns: "http://www.w3.org/2000/svg",
      "xmlns:xlink": "http://www.w3.org/1999/xlink",
    });
  });

  test("round-trips files exported from Adobe Illustrator", () => {
    const document = parse(illustrator);
    expect(parse(stringify(document))).toEqual(document);
  });

  test("expands entities in text", () => {
    expect(
      root(withSubset('<!ENTITY name "World">', "<svg>Hello, &name;!</svg>"))
        .children,
    ).toEqual([{ type: "text", value: "Hello, World!" }]);
  });

  test("expands nested entities", () => {
    const svg = withSubset(
      '<!ENTITY a "A"><!ENTITY b "[&a;&a;]"><!ENTITY c "&b;&lt;&b;">',
      "<svg>&c;</svg>",
    );
    expect(root(svg).children).toEqual([{ type: "text", value: "[AA]<[AA]" }]);
  });

  test("allows entities declared after the entities that use them", () => {
    const svg = withSubset(
      '<!ENTITY b "&a;!"><!ENTITY a "A">',
      "<svg>&b;</svg>",
    );
    expect(root(svg).children).toEqual([{ type: "text", value: "A!" }]);
  });

  test("expands character references in entity values", () => {
    const svg = withSubset(
      '<!ENTITY a "&#65;&#x42;"><!ENTITY amp2 "&#38;#38;">',
      '<svg x="&a;">&amp2;</svg>',
    );
    const element = root(svg);
    expect(element.attributes).toEqual({ x: "AB" });
    expect(element.children).toEqual([{ type: "text", value: "&" }]);
  });

  test("supports single-quoted values", () => {
    const svg = withSubset(`<!ENTITY q 'say "hi"'>`, "<svg>&q;</svg>");
    expect(root(svg).children).toEqual([{ type: "text", value: 'say "hi"' }]);
  });

  test("uses the first declaration of an entity", () => {
    const svg = withSubset(
      '<!ENTITY a "first"><!ENTITY a "second">',
      "<svg>&a;</svg>",
    );
    expect(root(svg).children).toEqual([{ type: "text", value: "first" }]);
  });

  test("ignores redeclared predefined entities", () => {
    const svg = withSubset('<!ENTITY lt "&#38;#60;">', "<svg>&lt;</svg>");
    expect(root(svg).children).toEqual([{ type: "text", value: "<" }]);
  });

  test("skips other declarations, comments, and processing instructions", () => {
    const svg =
      '<!DOCTYPE svg SYSTEM "svg[1].dtd" [\n' +
      "  <!ELEMENT svg ANY>\n" +
      '  <!ATTLIST svg title CDATA "a > b ] c">\n' +
      '  <!-- <!ENTITY commented "no"> ] -->\n' +
      "  <?pi > ] ?>\n" +
      '  <!NOTATION png SYSTEM "image/png">\n' +
      '  <!ENTITY a "yes">\n' +
      "]><svg>&a;</svg>";
    expect(root(svg).children).toEqual([{ type: "text", value: "yes" }]);
    expect(parseError(svg.replace("&a;", "&commented;")).code).toBe(
      "UNDEFINED_ENTITY",
    );
  });

  test("keeps the DOCTYPE as written", () => {
    const subset = '\n  <!ENTITY a "A">\n';
    const document = parse(withSubset(subset, "<svg/>"));
    expect(document.children[0]).toEqual({
      type: "doctype",
      value: `svg [${subset}]`,
    });
  });

  test("ignores parameter entities and declarations after their references", () => {
    const svg = withSubset(
      '<!ENTITY % pe "<!ENTITY hidden \'x\'>"><!ENTITY a "A">%pe;<!ENTITY b "B">',
      "<svg>&a;</svg>",
    );
    expect(root(svg).children).toEqual([{ type: "text", value: "A" }]);
    expect(parseError(svg.replace("&a;", "&b;")).code).toBe("UNDEFINED_ENTITY");
    expect(parseError(svg.replace("&a;", "&hidden;")).code).toBe(
      "UNDEFINED_ENTITY",
    );
    expect(parseError(svg.replace("&a;", "&pe;")).code).toBe(
      "UNDEFINED_ENTITY",
    );
  });
});

describe("entity errors", () => {
  test.each([
    ["undeclared entities", "", "&a;", "UNDEFINED_ENTITY"],
    [
      "external entities",
      '<!ENTITY ext SYSTEM "file:///etc/passwd">',
      "&ext;",
      "EXTERNAL_ENTITY",
    ],
    [
      "public external entities",
      '<!ENTITY ext PUBLIC "-//X//EN" "http://example.com/x">',
      "&ext;",
      "EXTERNAL_ENTITY",
    ],
    [
      "external entities used by internal ones",
      '<!ENTITY ext SYSTEM "x.txt"><!ENTITY a "&ext;">',
      "&a;",
      "EXTERNAL_ENTITY",
    ],
    ["entities with markup", '<!ENTITY m "<g/>">', "&m;", "UNSUPPORTED_ENTITY"],
    [
      "entities with markup from character references",
      '<!ENTITY m "&#60;g/>">',
      "&m;",
      "UNSUPPORTED_ENTITY",
    ],
    [
      "recursive entities",
      '<!ENTITY a "&b;"><!ENTITY b "&a;">',
      "&a;",
      "MALFORMED_XML",
    ],
    ["self-referencing entities", '<!ENTITY a "x&a;">', "&a;", "MALFORMED_XML"],
    [
      "undeclared nested entities",
      '<!ENTITY a "&b;">',
      "&a;",
      "UNDEFINED_ENTITY",
    ],
  ])("rejects %s", (_name, subset, reference, code) => {
    expect(parseError(withSubset(subset, `<svg>${reference}</svg>`)).code).toBe(
      code,
    );
  });

  test("allows unused external entities", () => {
    const svg = withSubset('<!ENTITY ext SYSTEM "x.txt">', "<svg/>");
    expect(() => parse(svg)).not.toThrow();
  });

  test("allows unused entities with markup", () => {
    expect(() =>
      parse(withSubset('<!ENTITY m "<g/>">', "<svg/>")),
    ).not.toThrow();
  });

  test("rejects entities with markup in attributes", () => {
    const svg = withSubset('<!ENTITY m "&#60;">', '<svg a="&m;"/>');
    expect(parseError(svg).code).toBe("UNSUPPORTED_ENTITY");
  });

  test.each([
    ["an invalid entity name", '<!ENTITY 1a "x">'],
    ["a missing value", "<!ENTITY a>"],
    ["an unquoted value", "<!ENTITY a x>"],
    ["a malformed reference", '<!ENTITY a "&;">'],
    ["a bare ampersand", '<!ENTITY a "a & b">'],
    ["a parameter entity reference in a value", '<!ENTITY a "%pe;">'],
    ["an invalid character reference", '<!ENTITY a "&#0;">'],
    ["unexpected text", 'text <!ENTITY a "x">'],
  ])("rejects %s", (_name, subset) => {
    expect(parseError(withSubset(subset, "<svg/>")).code).toBe("MALFORMED_XML");
  });

  test("reports the position of the reference", () => {
    const error = parseError(
      withSubset('<!ENTITY m "<g/>">', "<svg>\n  &m;</svg>"),
    );
    expect(error.line).toBe(2);
  });
});

describe("entity limits", () => {
  const billionLaughs = withSubset(
    '<!ENTITY lol "lol">' +
      Array.from(
        { length: 9 },
        (_, i) =>
          `<!ENTITY lol${i + 1} "${`&lol${i === 0 ? "" : i};`.repeat(10)}">`,
      ).join(""),
    "<svg>&lol9;</svg>",
  );

  test("rejects exponential expansion", () => {
    const error = parseError(billionLaughs);
    expect([
      "MAX_ENTITY_EXPANSIONS_EXCEEDED",
      "MAX_EXPANDED_LENGTH_EXCEEDED",
    ]).toContain(error.code);
  });

  test("rejects many references to a large entity", () => {
    const svg = withSubset(
      `<!ENTITY big "${"x".repeat(100_000)}">`,
      `<svg>${"&big;".repeat(20)}</svg>`,
    );
    expect(parseError(svg).code).toBe("MAX_EXPANDED_LENGTH_EXCEEDED");
  });

  test("rejects deeply nested entities", () => {
    const subset = Array.from(
      { length: 200 },
      (_, i) => `<!ENTITY e${i} "${i === 199 ? "x" : `&e${i + 1};`}">`,
    ).join("");
    const error = parseError(withSubset(subset, "<svg>&e0;</svg>"));
    expect(error.code).toBe("MAX_ENTITY_EXPANSIONS_EXCEEDED");
  });

  test("respects maxEntityExpansions", () => {
    const svg = withSubset('<!ENTITY a "A">', "<svg>&a;&a;&a;</svg>");
    expect(() => parse(svg, { maxEntityExpansions: 3 })).not.toThrow();
    expect(parseError(svg, { maxEntityExpansions: 2 }).code).toBe(
      "MAX_ENTITY_EXPANSIONS_EXCEEDED",
    );
  });

  test("counts nested expansions", () => {
    const svg = withSubset(
      '<!ENTITY a "A"><!ENTITY b "&a;&a;">',
      "<svg>&b;</svg>",
    );
    expect(() => parse(svg, { maxEntityExpansions: 3 })).not.toThrow();
    expect(parseError(svg, { maxEntityExpansions: 2 }).code).toBe(
      "MAX_ENTITY_EXPANSIONS_EXCEEDED",
    );
  });

  test("respects maxExpandedLength", () => {
    const svg = withSubset('<!ENTITY a "12345">', '<svg a="&a;">&a;</svg>');
    expect(() => parse(svg, { maxExpandedLength: 10 })).not.toThrow();
    expect(parseError(svg, { maxExpandedLength: 9 }).code).toBe(
      "MAX_EXPANDED_LENGTH_EXCEEDED",
    );
  });

  test("does not count predefined entities and character references", () => {
    const svg = "<svg>" + "&amp;&#65;".repeat(1000) + "</svg>";
    expect(() =>
      parse(svg, { maxEntityExpansions: 0, maxExpandedLength: 0 }),
    ).not.toThrow();
  });
});
