import type { SvgDocument, SvgElement } from "./types";

/**
 * Returns the document's root element without copying it.
 *
 * Changes to the returned element also change the document. The root is always
 * present in documents returned by `parse()`. Its name is not required to be
 * `"svg"`, matching `parse()` and `stringify()`.
 *
 * Throws a `TypeError` when the document has no root element or has more than
 * one, for example after manually editing its children.
 */
export function getRoot(document: SvgDocument): SvgElement {
  let root: SvgElement | undefined;

  for (const child of document.children) {
    if (child.type === "element") {
      if (root !== undefined) {
        throw new TypeError("A document must have exactly one root element");
      }
      root = child;
    }
  }

  if (root === undefined) {
    throw new TypeError("A document must have exactly one root element");
  }

  return root;
}
