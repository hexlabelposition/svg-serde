import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { SvgParseError } from "./errors";
import { parse } from "./parse";
import { stringify } from "./stringify";
import type {
  SvgComment,
  SvgDocument,
  SvgDocumentChild,
  SvgElement,
  SvgInstruction,
  SvgNode,
  SvgText,
} from "./types";

/**
 * Names without a reserved "xml" prefix. Element and attribute names may use
 * the "p" prefix, which the root element always declares.
 */
const localName = fc
  .tuple(
    fc.constantFrom(...Array.from("abcxyzABZ_éЖ中")),
    fc.string({
      unit: fc.constantFrom(...Array.from("abz09-._·éЖ中")),
      maxLength: 6,
    }),
  )
  .map(([start, rest]) => start + rest)
  .filter((name) => !/^xml/i.test(name));

const qualifiedName = fc.oneof(
  { weight: 4, arbitrary: localName },
  { weight: 1, arbitrary: localName.map((name) => `p:${name}`) },
);

const char = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...Array.from("abcXYZ019 ")) },
  { weight: 3, arbitrary: fc.constantFrom(...Array.from("&<>\"';#-?!/=[]%")) },
  { weight: 2, arbitrary: fc.constantFrom("\t", "\n", "\r") },
  { weight: 1, arbitrary: fc.constantFrom("é", "Ж", "中", "😀", "𝒳") },
);

/**
 * Comments, CDATA sections, and processing instructions cannot escape "\r",
 * which parsers normalize to "\n".
 */
const charWithoutCarriageReturn = char.filter((c) => c !== "\r");

const textNode: fc.Arbitrary<SvgText> = fc.record({
  type: fc.constant("text"),
  value: fc.string({ unit: char, minLength: 1, maxLength: 20 }),
});

const whitespaceNode: fc.Arbitrary<SvgText> = fc.record({
  type: fc.constant("text"),
  value: fc.string({
    unit: fc.constantFrom(" ", "\t", "\n"),
    minLength: 1,
    maxLength: 3,
  }),
});

const cdataNode = fc.record({
  type: fc.constant("cdata"),
  value: fc
    .string({ unit: charWithoutCarriageReturn, maxLength: 20 })
    .filter((value) => !value.includes("]]>")),
});

const commentNode: fc.Arbitrary<SvgComment> = fc.record({
  type: fc.constant("comment"),
  value: fc
    .string({ unit: charWithoutCarriageReturn, maxLength: 20 })
    .filter((value) => !value.includes("--") && !value.endsWith("-")),
});

const instructionNode: fc.Arbitrary<SvgInstruction> = fc.record({
  type: fc.constant("instruction"),
  target: localName,
  value: fc
    .string({ unit: charWithoutCarriageReturn, maxLength: 20 })
    // Whitespace after the target separates it from the value.
    .filter((value) => !value.includes("?>") && !/^[ \t\n]/.test(value)),
});

const attributes = fc.dictionary(
  qualifiedName,
  fc.string({ unit: char, maxLength: 12 }),
  { maxKeys: 4 },
);

const { element } = fc.letrec<{ node: SvgNode; element: SvgElement }>(
  (tie) => ({
    // At the maximum depth, oneof picks the first arbitrary, a leaf.
    node: fc.oneof(
      { maxDepth: 4 },
      textNode,
      cdataNode,
      commentNode,
      instructionNode,
      tie("element"),
    ),
    element: fc.record({
      type: fc.constant("element"),
      name: qualifiedName,
      attributes,
      children: fc.array(tie("node"), { maxLength: 5 }),
    }),
  }),
);

const misc = fc.array(fc.oneof(whitespaceNode, commentNode, instructionNode), {
  maxLength: 3,
});

const documentArbitrary: fc.Arbitrary<SvgDocument> = fc
  .record({
    declaration: fc.option(
      fc.record(
        {
          version: fc.constant("1.0"),
          encoding: fc.constantFrom("UTF-8", "utf-8", "ISO-8859-1"),
          standalone: fc.constantFrom("yes" as const, "no" as const),
        },
        { requiredKeys: ["version"] },
      ),
      { nil: undefined },
    ),
    beforeDoctype: misc,
    doctype: fc.option(
      fc.constantFrom(
        "svg",
        'svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"',
        'svg [\n  <!ENTITY a "A">\n  <!-- ] -->\n]',
      ),
      { nil: undefined },
    ),
    beforeRoot: misc,
    root: element,
    afterRoot: misc,
  })
  .map(
    ({ declaration, beforeDoctype, doctype, beforeRoot, root, afterRoot }) => {
      const children: SvgDocumentChild[] = [
        ...beforeDoctype,
        ...(doctype === undefined
          ? []
          : [{ type: "doctype" as const, value: doctype }]),
        ...beforeRoot,
        { ...root, attributes: { "xmlns:p": "urn:p", ...root.attributes } },
        ...afterRoot,
      ];
      return declaration === undefined
        ? { type: "document", children }
        : { type: "document", declaration, children };
    },
  );

/**
 * Merges adjacent text nodes, which a parser reads back as one node.
 */
function normalize<T extends SvgNode | SvgDocumentChild>(nodes: T[]): T[] {
  const result: T[] = [];
  for (const node of nodes) {
    const last = result.at(-1);
    if (node.type === "text" && last?.type === "text") {
      result[result.length - 1] = { ...last, value: last.value + node.value };
    } else if (node.type === "element") {
      result.push({ ...node, children: normalize(node.children) });
    } else {
      result.push(node);
    }
  }
  return result;
}

function normalizeDocument(document: SvgDocument): SvgDocument {
  return { ...document, children: normalize(document.children) };
}

/**
 * Markup fragments that steer random strings toward interesting parser states.
 */
const markup = fc.constantFrom(
  "<",
  ">",
  "/",
  "!",
  "?",
  "&",
  ";",
  "#",
  "=",
  '"',
  "'",
  ":",
  "[",
  "]",
  "-",
  " ",
  "\n",
  "%",
  "a",
  "x",
  "1",
  "svg",
  "<svg>",
  "</svg>",
  "<svg/>",
  "<g>",
  "</g>",
  'a="1"',
  'p:a="1"',
  "<!DOCTYPE svg [",
  "<!ENTITY a ",
  '"&b;"',
  '"<g/>"',
  "SYSTEM",
  "<!ATTLIST",
  "<![CDATA[",
  "]]>",
  "<!--",
  "-->",
  "<?pi ",
  "?>",
  '<?xml version="1.0"?>',
  "&a;",
  "&b;",
  "&amp;",
  "&#38;",
  "&#x0;",
  'xmlns:p="urn:p"',
);

describe("properties", () => {
  test("parse(stringify(document)) equals the document", () => {
    fc.assert(
      fc.property(documentArbitrary, (document) => {
        expect(parse(stringify(document))).toEqual(normalizeDocument(document));
      }),
      { numRuns: 1000 },
    );
  });

  test("parse either returns a round-trippable document or throws SvgParseError", () => {
    const mutated = fc
      .tuple(
        documentArbitrary,
        fc.nat(),
        fc.nat(10),
        fc.string({ unit: markup, maxLength: 5 }),
      )
      .map(([document, at, remove, insert]) => {
        const svg = stringify(document);
        const index = at % (svg.length + 1);
        return svg.slice(0, index) + insert + svg.slice(index + remove);
      });

    const input = fc.oneof(
      fc.string({ unit: markup, maxLength: 40 }),
      fc
        .string({ unit: markup, maxLength: 40 })
        .map((s) => `<!DOCTYPE svg [${s}]><svg>${s}</svg>`),
      mutated,
    );

    fc.assert(
      fc.property(input, (svg) => {
        let document: SvgDocument;
        try {
          document = parse(svg);
        } catch (error) {
          expect(error).toBeInstanceOf(SvgParseError);
          return;
        }
        expect(parse(stringify(document))).toEqual(document);
      }),
      { numRuns: 3000 },
    );
  });
});
