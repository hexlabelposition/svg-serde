import {
  CLOSE_BRACKET,
  DQUOTE,
  GT,
  isWhitespace,
  LT,
  OPEN_BRACKET,
  QUESTION,
  SQUOTE,
} from "./chars";
import {
  CHAR_REFERENCE,
  charFromReference,
  NAME,
  PREDEFINED_ENTITIES,
} from "./xml";

/**
 * A general entity declared in the DOCTYPE internal subset.
 */
export type EntityDeclaration =
  | {
      type: "internal";
      /**
       * Replacement text with character references expanded and entity
       * references kept as written.
       */
      value: string;
    }
  | {
      type: "external";
    };

// Patterns for the part of a declaration after `<!ENTITY`. `S` is the XML
// whitespace production.
const S = "[ \\t\\r\\n]";
const QUOTED = `(?:"[^"]*"|'[^']*')`;

// `% name ...`
const PARAMETER_ENTITY = new RegExp(`^${S}+%${S}`);
// `name "value"`
const INTERNAL_ENTITY = new RegExp(
  `^${S}+([^ \\t\\r\\n%"'>]+)${S}+(?:"([^"]*)"|'([^']*)')${S}*$`,
);
// `name SYSTEM "uri"` or `name PUBLIC "id" "uri"`, optionally with `NDATA`.
const EXTERNAL_ENTITY = new RegExp(
  `^${S}+([^ \\t\\r\\n%"'>]+)${S}+` +
    `(?:SYSTEM${S}+${QUOTED}|PUBLIC${S}+${QUOTED}${S}+${QUOTED})` +
    `(?:${S}+NDATA${S}+[^ \\t\\r\\n>]+)?${S}*$`,
);

const WHITESPACE = /[ \t\r\n]/;

/**
 * Collects general entity declarations from the internal subset of a DOCTYPE.
 *
 * `doctype` is the DOCTYPE content after the `DOCTYPE` keyword, whose end
 * `parse()` has already found. Other markup declarations, comments,
 * and processing instructions in the subset are skipped. As XML requires
 * of processors that do not read external declarations, entity
 * declarations after a parameter entity reference are ignored.
 */
export function parseEntityDeclarations(
  doctype: string,
  fail: (message: string) => never,
): Map<string, EntityDeclaration> {
  const entities = new Map<string, EntityDeclaration>();
  let ignoreDeclarations = false;
  let i = findInternalSubset(doctype);

  if (i === -1) {
    return entities;
  }

  while (true) {
    while (i < doctype.length && WHITESPACE.test(doctype.charAt(i))) {
      i++;
    }

    if (i >= doctype.length) {
      fail("Unterminated DOCTYPE internal subset");
    }

    if (doctype.charAt(i) === "]") {
      return entities;
    }

    if (doctype.startsWith("<!--", i)) {
      i = skipPast(doctype, i + 4, "-->", fail);
    } else if (doctype.startsWith("<?", i)) {
      i = skipPast(doctype, i + 2, "?>", fail);
    } else if (doctype.charAt(i) === "%") {
      ignoreDeclarations = true;
      i = skipPast(doctype, i + 1, ";", fail);
    } else if (doctype.startsWith("<!ENTITY", i)) {
      const end = findDeclarationEnd(doctype, i, fail);
      const entity = parseEntityDeclaration(doctype.slice(i + 8, end), fail);
      if (
        entity !== undefined &&
        !ignoreDeclarations &&
        !PREDEFINED_ENTITIES.has(entity.name) &&
        !entities.has(entity.name)
      ) {
        // Redeclaring a predefined entity has no effect, and the first
        // declaration of any other entity is binding.
        entities.set(entity.name, entity.declaration);
      }
      i = end + 1;
    } else if (doctype.startsWith("<!", i)) {
      i = findDeclarationEnd(doctype, i, fail) + 1;
    } else {
      fail("Malformed DOCTYPE internal subset");
    }
  }
}

/**
 * Parses the part of an entity declaration between `<!ENTITY` and `>`.
 * Returns `undefined` for parameter entities, which are not supported.
 */
function parseEntityDeclaration(
  body: string,
  fail: (message: string) => never,
): { name: string; declaration: EntityDeclaration } | undefined {
  if (PARAMETER_ENTITY.test(body)) {
    return undefined;
  }

  const internal = INTERNAL_ENTITY.exec(body);
  if (internal !== null) {
    const name = validateName(internal[1] ?? "", fail);
    const value = internal[2] ?? internal[3] ?? "";
    return {
      name,
      declaration: {
        type: "internal",
        value: expandCharReferences(value, fail),
      },
    };
  }

  const external = EXTERNAL_ENTITY.exec(body);
  if (external !== null) {
    const name = validateName(external[1] ?? "", fail);
    return { name, declaration: { type: "external" } };
  }

  fail("Malformed entity declaration");
}

/**
 * Expands character references in an entity value literal and checks that
 * entity references are well-formed.
 */
function expandCharReferences(
  value: string,
  fail: (message: string) => never,
): string {
  if (value.includes("%")) {
    fail("Parameter entity references are not allowed in the internal subset");
  }

  return value.replace(/&([^;]*);|&/g, (match, reference?: string) => {
    if (reference === undefined) {
      fail("Malformed reference in entity value");
    }
    if (CHAR_REFERENCE.test(reference)) {
      return charFromReference(reference, fail);
    }
    if (NAME.test(reference)) {
      return match;
    }
    fail("Malformed reference in entity value");
  });
}

function validateName(name: string, fail: (message: string) => never): string {
  if (!NAME.test(name)) {
    fail(`Invalid entity name: ${JSON.stringify(name)}`);
  }
  return name;
}

/**
 * Returns the index after the `[` that opens the internal subset, or -1.
 */
function findInternalSubset(doctype: string): number {
  for (let i = 0; i < doctype.length; i++) {
    const char = doctype.charAt(i);
    if (char === '"' || char === "'") {
      const end = doctype.indexOf(char, i + 1);
      if (end === -1) {
        return -1;
      }
      i = end;
    } else if (char === "[") {
      return i + 1;
    }
  }
  return -1;
}

/**
 * Returns the index of the `>` that ends the markup declaration at `start`,
 * skipping quoted literals.
 */
function findDeclarationEnd(
  doctype: string,
  start: number,
  fail: (message: string) => never,
): number {
  for (let i = start; i < doctype.length; i++) {
    const char = doctype.charAt(i);
    if (char === '"' || char === "'") {
      const end = doctype.indexOf(char, i + 1);
      if (end === -1) {
        break;
      }
      i = end;
    } else if (char === ">") {
      return i;
    }
  }
  fail("Unterminated markup declaration in DOCTYPE");
}

/**
 * Returns the index after the first `terminator` at or after `start`.
 */
function skipPast(
  doctype: string,
  start: number,
  terminator: string,
  fail: (message: string) => never,
): number {
  const end = doctype.indexOf(terminator, start);
  if (end === -1) {
    fail("Malformed DOCTYPE internal subset");
  }
  return end + terminator.length;
}

/**
 * Returns the offset of the `>` that ends a DOCTYPE whose content starts at
 * `start`, right after the `DOCTYPE` keyword. Skips quoted literals and the
 * internal subset with the comments and processing instructions in it.
 */
export function findDoctypeEnd(
  svg: string,
  start: number,
  fail: (message: string, offset: number) => never,
): number {
  if (!isWhitespace(svg.charCodeAt(start))) {
    fail("Whitespace required after DOCTYPE", start);
  }
  let inSubset = false;
  let i = start;
  while (i < svg.length) {
    const c = svg.charCodeAt(i);
    if (c === DQUOTE || c === SQUOTE) {
      const end = svg.indexOf(c === DQUOTE ? '"' : "'", i + 1);
      if (end === -1) {
        break;
      }
      i = end + 1;
    } else if (inSubset) {
      if (c === CLOSE_BRACKET) {
        inSubset = false;
        i++;
      } else if (c === LT && svg.startsWith("<!--", i)) {
        const end = svg.indexOf("-->", i + 4);
        if (end === -1) {
          break;
        }
        i = end + 3;
      } else if (c === LT && svg.charCodeAt(i + 1) === QUESTION) {
        const end = svg.indexOf("?>", i + 2);
        if (end === -1) {
          break;
        }
        i = end + 2;
      } else {
        i++;
      }
    } else if (c === GT) {
      return i;
    } else {
      if (c === OPEN_BRACKET) {
        inSubset = true;
      }
      i++;
    }
  }
  // Point at the "<!DOCTYPE" that starts the declaration.
  return fail("Unterminated DOCTYPE", start - 9);
}
