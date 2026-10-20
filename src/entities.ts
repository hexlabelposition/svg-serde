import type { EntityDeclaration } from "./doctype";
import type { SvgParseErrorCode } from "./errors";
import { CHAR_REFERENCE, charFromReference, PREDEFINED_ENTITIES } from "./xml";

export interface EntityLimits {
  maxEntityExpansions: number;
  maxExpandedLength: number;
}

/**
 * Maximum nesting of entity references inside entity values.
 *
 * Keeps expansion from exhausting the call stack before the expansion
 * limits are reached.
 */
const MAX_ENTITY_NESTING = 64;

interface Expansion {
  text: string;
  /**
   * Number of entity references expanded to produce `text`.
   */
  expansions: number;
}

/**
 * Creates a function that returns the replacement text for a reference to a
 * declared entity, recursively expanding the references in it.
 *
 * Expansions are cached per entity, while the limits count every reference
 * in the document, so repeated references to a large entity are caught.
 */
export function createEntityResolver(
  declarations: Map<string, EntityDeclaration>,
  limits: EntityLimits,
  fail: (message: string, code: SvgParseErrorCode) => never,
): (name: string) => string {
  const cache = new Map<string, Expansion>();
  const expanding = new Set<string>();
  let totalExpansions = 0;
  let totalLength = 0;

  const checkLimits = (expansions: number, length: number): void => {
    if (expansions > limits.maxEntityExpansions) {
      fail(
        `More than ${limits.maxEntityExpansions} entity references expanded`,
        "MAX_ENTITY_EXPANSIONS_EXCEEDED",
      );
    }
    if (length > limits.maxExpandedLength) {
      fail(
        `Entity expansion is longer than ${limits.maxExpandedLength} characters`,
        "MAX_EXPANDED_LENGTH_EXCEEDED",
      );
    }
  };

  const expand = (name: string): Expansion => {
    const cached = cache.get(name);
    if (cached !== undefined) {
      return cached;
    }

    const declaration = declarations.get(name);
    if (declaration === undefined) {
      fail(`Undefined entity: ${name}`, "UNDEFINED_ENTITY");
    }
    if (declaration.type === "external") {
      fail(`External entity is not supported: ${name}`, "EXTERNAL_ENTITY");
    }
    if (expanding.has(name)) {
      fail(`Recursive entity reference: ${name}`, "MALFORMED_XML");
    }
    if (expanding.size >= MAX_ENTITY_NESTING) {
      fail(
        `Entity references are nested deeper than ${MAX_ENTITY_NESTING} levels`,
        "MAX_ENTITY_EXPANSIONS_EXCEEDED",
      );
    }

    expanding.add(name);
    let text = "";
    let expansions = 0;
    let last = 0;

    // The replacement text is parsed again where it is referenced, so
    // references in it are expanded and markup is detected.
    for (const match of declaration.value.matchAll(/&([^;]*);|[<&]/g)) {
      text += declaration.value.slice(last, match.index);
      last = match.index + match[0].length;

      const reference = match[1];
      if (match[0] === "<") {
        fail(
          `Entity contains markup, which is not supported: ${name}`,
          "UNSUPPORTED_ENTITY",
        );
      }
      if (reference === undefined) {
        fail(`Malformed reference in entity: ${name}`, "MALFORMED_XML");
      }

      const predefined = PREDEFINED_ENTITIES.get(reference);
      if (CHAR_REFERENCE.test(reference)) {
        text += charFromReference(reference, (message) =>
          fail(message, "MALFORMED_XML"),
        );
      } else if (predefined !== undefined) {
        text += predefined;
      } else {
        const inner = expand(reference);
        text += inner.text;
        expansions += 1 + inner.expansions;
      }
      checkLimits(expansions, text.length);
    }

    text += declaration.value.slice(last);
    checkLimits(expansions, text.length);
    expanding.delete(name);

    const expansion = { text, expansions };
    cache.set(name, expansion);
    return expansion;
  };

  return (name) => {
    const { text, expansions } = expand(name);
    totalExpansions += 1 + expansions;
    totalLength += text.length;
    checkLimits(totalExpansions, totalLength);
    return text;
  };
}
