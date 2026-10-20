/**
 * Namespaces reserved by Namespaces in XML for the `xml` and `xmlns` prefixes:
 * https://www.w3.org/TR/xml-names/#ns-decl
 */
export const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
export const XMLNS_NAMESPACE = "http://www.w3.org/2000/xmlns/";

/**
 * Splits a qualified name into prefix and local part.
 */
export function splitPrefix(
  name: string,
  offset: number,
  fail: (message: string, offset: number) => never,
): [string, string] {
  const colon = name.indexOf(":");
  if (
    colon <= 0 ||
    colon === name.length - 1 ||
    name.includes(":", colon + 1)
  ) {
    fail(`Malformed name: ${name}`, offset);
  }
  return [name.slice(0, colon), name.slice(colon + 1)];
}

/**
 * Checks a namespace declaration as required by Namespaces in XML.
 */
export function checkNamespace(
  prefix: string,
  uri: string,
  xml11: boolean,
  fail: (message: string) => never,
): void {
  if (prefix === "xml" && uri !== XML_NAMESPACE) {
    fail(`The xml prefix must be bound to ${XML_NAMESPACE}`);
  }
  if (prefix === "xmlns") {
    fail('The "xmlns" prefix must not be declared');
  }
  if (uri === XMLNS_NAMESPACE) {
    fail(`No prefix may be bound to ${XMLNS_NAMESPACE}`);
  }
  if (uri === XML_NAMESPACE && prefix !== "xml") {
    fail(`Only the xml prefix may be bound to ${XML_NAMESPACE}`);
  }
  if (prefix !== "" && uri === "" && !xml11) {
    fail(`Namespace prefix cannot be undeclared in XML 1.0: ${prefix}`);
  }
}
