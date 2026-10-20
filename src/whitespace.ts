import type { SvgDocumentChild, SvgElement, SvgNode } from "./types";

/**
 * Matches strings that are empty or contain only XML whitespace.
 */
export const WHITESPACE: RegExp = /^[ \t\r\n]*$/;

/**
 * Elements whose content is text, where whitespace is never changed.
 */
const TEXT_ELEMENTS: ReadonlySet<string> = new Set([
  "text",
  "tspan",
  "textPath",
  "style",
  "script",
  "title",
  "desc",
]);

/**
 * Whether whitespace in an element's content is insignificant, so that
 * `pretty` can replace it and `whitespace: "trim"` can remove it.
 */
export function isElementOnly(element: SvgElement): boolean {
  return (
    !TEXT_ELEMENTS.has(element.name) &&
    element.attributes["xml:space"] !== "preserve" &&
    element.children.every(
      (child) =>
        child.type !== "cdata" &&
        (child.type !== "text" || WHITESPACE.test(child.value)),
    )
  );
}

/**
 * Removes whitespace-only text nodes from top-level `nodes` and from
 * element-only content below them, changing elements in place. Content that
 * is not element-only is kept as is, including nested elements, matching
 * what `pretty` reformats.
 */
export function trimWhitespace<T extends SvgNode | SvgDocumentChild>(
  nodes: T[],
): T[] {
  const result = nodes.filter(
    (node) => node.type !== "text" || !WHITESPACE.test(node.value),
  );
  for (const node of result) {
    if (node.type === "element" && isElementOnly(node)) {
      node.children = trimWhitespace(node.children);
    }
  }
  return result;
}
