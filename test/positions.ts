import type {
  SvgDocument,
  SvgDocumentChild,
  SvgNode,
  SvgPosition,
  SvgSourcePoint,
} from "../src/index";

/**
 * Returns why the positions of a document parsed from `source` with
 * `positions: true` are wrong, or `undefined` if they are correct.
 *
 * Checks that siblings cover the source without gaps, that each range holds
 * the node as written, and that every point has the right line and column.
 * Expects whitespace to be preserved.
 */
export function checkPositions(
  source: string,
  document: SvgDocument,
): string | undefined {
  const lineStarts = [0];
  for (const match of source.matchAll(/\r\n?|\n/g)) {
    lineStarts.push(match.index + match[0].length);
  }

  const checkPoint = (point: SvgSourcePoint): string | undefined => {
    let line = 0;
    for (let low = 0, high = lineStarts.length - 1; low <= high;) {
      const middle = (low + high) >> 1;
      if ((lineStarts[middle] ?? 0) <= point.offset) {
        line = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    const column = point.offset - (lineStarts[line] ?? 0) + 1;
    return point.line === line + 1 && point.column === column
      ? undefined
      : `point ${JSON.stringify(point)} should be at ${line + 1}:${column}`;
  };

  const slice = (position: SvgPosition): string =>
    source.slice(position.start.offset, position.end.offset);

  const checkNodes = (
    nodes: (SvgNode | SvgDocumentChild)[],
    end: number,
  ): string | undefined => {
    let previousEnd: number | undefined;
    for (const node of nodes) {
      const { position } = node;
      if (position === undefined) {
        return `${node.type} has no position`;
      }
      if (previousEnd !== undefined && position.start.offset !== previousEnd) {
        return `${node.type} at ${position.start.offset} does not start at ${previousEnd}`;
      }
      previousEnd = position.end.offset;
      const reason =
        checkPoint(position.start) ??
        checkPoint(position.end) ??
        checkNode(node, position);
      if (reason !== undefined) {
        return reason;
      }
    }
    return previousEnd === undefined || previousEnd === end
      ? undefined
      : `last node ends at ${previousEnd}, not ${end}`;
  };

  const checkNode = (
    node: SvgNode | SvgDocumentChild,
    position: SvgPosition,
  ): string | undefined => {
    const text = slice(position);
    const normalized = text.replace(/\r\n?/g, "\n");
    const fail = `${node.type} range ${JSON.stringify(text)} does not match`;

    switch (node.type) {
      case "element": {
        if (!new RegExp(`^<${node.name}[ \\t\\r\\n/>]`).test(text)) {
          return fail;
        }
        const first = node.children[0]?.position;
        const last = node.children.at(-1)?.position;
        if (first === undefined || last === undefined) {
          return text.endsWith(">") ? undefined : fail;
        }
        const endTag = source.slice(last.end.offset, position.end.offset);
        if (
          !source
            .slice(position.start.offset, first.start.offset)
            .endsWith(">") ||
          !new RegExp(`^</${node.name}[ \\t\\r\\n]*>$`).test(endTag)
        ) {
          return fail;
        }
        return checkNodes(node.children, last.end.offset);
      }
      case "text":
        if (text.includes("<")) {
          return fail;
        }
        return text.includes("&") || normalized === node.value
          ? undefined
          : fail;
      case "cdata":
        return normalized === `<![CDATA[${node.value}]]>` ? undefined : fail;
      case "comment":
        return normalized === `<!--${node.value}-->` ? undefined : fail;
      case "instruction":
        return normalized.startsWith(`<?${node.target}`) &&
          normalized.endsWith(`${node.value}?>`)
          ? undefined
          : fail;
      case "doctype":
        return text.startsWith("<!DOCTYPE") && text.endsWith(">")
          ? undefined
          : fail;
    }
  };

  const start = document.children[0]?.position?.start.offset;
  const prolog = source.slice(0, start).replace(/^\uFEFF/, "");
  const expectedProlog =
    document.declaration === undefined ? "" : /^<\?xml[^]*\?>$/;
  if (
    typeof expectedProlog === "string"
      ? prolog !== expectedProlog
      : !expectedProlog.test(prolog)
  ) {
    return `first node starts at ${String(start)}`;
  }
  return checkNodes(document.children, source.length);
}
