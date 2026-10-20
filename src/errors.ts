/**
 * Stable, machine-readable reason for an `SvgParseError`.
 *
 * Use it to handle specific failures, e.g. to report a size limit differently
 * from malformed markup. Existing codes change only in major releases, and new
 * codes may be added in minor releases, while the message text may change in
 * any release.
 */
export type SvgParseErrorCode =
  /**
   * The input is not well-formed XML.
   */
  | "MALFORMED_XML"
  /**
   * The document has no root element.
   */
  | "MISSING_ROOT"
  /**
   * An element or attribute uses a namespace prefix that is not declared.
   */
  | "UNDECLARED_PREFIX"
  /**
   * A reference to an entity that is not declared.
   */
  | "UNDEFINED_ENTITY"
  /**
   * A reference to an external entity, which is never loaded.
   */
  | "EXTERNAL_ENTITY"
  /**
   * A reference to an entity whose replacement text contains markup,
   * such as `<!ENTITY e "<g/>">`. Only text replacements are supported.
   */
  | "UNSUPPORTED_ENTITY"
  /**
   * The input is longer than `ParseOptions.maxInputLength`.
   */
  | "MAX_INPUT_LENGTH_EXCEEDED"
  /**
   * Elements are nested deeper than `ParseOptions.maxDepth`.
   */
  | "MAX_DEPTH_EXCEEDED"
  /**
   * More entity references than `ParseOptions.maxEntityExpansions`.
   */
  | "MAX_ENTITY_EXPANSIONS_EXCEEDED"
  /**
   * Expanded entity text longer than `ParseOptions.maxExpandedLength`.
   */
  | "MAX_EXPANDED_LENGTH_EXCEEDED";

/**
 * Data used to construct an `SvgParseError`.
 *
 * Needed only to create the error yourself, e.g. in tests or in a wrapper
 * that reports its own validation failures the same way.
 */
export interface SvgParseErrorDetails {
  code: SvgParseErrorCode;
  /**
   * 1-based line number.
   */
  line: number;
  /**
   * 1-based column number.
   */
  column: number;
  /**
   * 0-based character offset.
   */
  offset: number;
  /**
   * The underlying error, if any.
   */
  cause?: unknown;
}

/**
 * Thrown by `parse()` for any input it cannot turn into a document.
 *
 * Catch it with `instanceof SvgParseError`, branch on `code`, and use
 * `line`, `column`, or `offset` to point the user at the problem in the source.
 */
export class SvgParseError extends Error {
  override readonly name = "SvgParseError";

  readonly code: SvgParseErrorCode;
  /**
   * 1-based line number.
   */
  readonly line: number;
  /**
   * 1-based column number.
   */
  readonly column: number;
  /**
   * 0-based character offset, e.g. for `source.slice(offset)`.
   */
  readonly offset: number;

  constructor(message: string, details: SvgParseErrorDetails) {
    super(
      `${message} (line ${details.line}, column ${details.column})`,
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.code = details.code;
    this.line = details.line;
    this.column = details.column;
    this.offset = details.offset;
  }
}
