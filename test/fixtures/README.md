# SVG corpus fixtures

Small editor exports and SVGO regression inputs, checked by
`test/corpus.test.ts` in Node.js and Bun. Every source directory must contain
SVG files. Each file must parse, round-trip without changing the document, and
produce stable compact and pretty output. Tests use local files only.

## Sources and licenses

These third-party fixtures retain their original licenses; they are not covered
by svg-serde's MIT license. License texts and notices are kept in `licenses/`.
Fixtures are test data and are not included in the npm package.

### Inkscape — KDE Oxygen Icons 5.116.0

Source: [original release archive](https://download.kde.org/stable/frameworks/5.116/oxygen-icons-5.116.0.tar.xz).
The SVGs identify Inkscape in their generator comments. Files are unchanged;
`go-next-view.svgz` was decompressed to `go-next-view.svg`.

| Fixture                     | Path inside `oxygen-icons-5.116.0/`              | Coverage                                                      |
| --------------------------- | ------------------------------------------------ | ------------------------------------------------------------- |
| `inkscape/go-next-view.svg` | `scalable/actions/small/16x16/go-next-view.svgz` | Gradients, `xlink:href`, path data, attribute order           |
| `inkscape/emblem-pause.svg` | `scalable/emblems/small/8x8/emblem-pause.svg`    | Inkscape/Sodipodi namespaces, RDF metadata, editor attributes |

License: LGPL v3 or later with Oxygen's artwork clarification; see
[upstream COPYING](licenses/oxygen-icons-COPYING.txt),
[upstream COPYING.LIB](licenses/oxygen-icons-COPYING.LIB.txt),
[GPL v3](licenses/GPL-3.0.txt), and
[upstream AUTHORS](licenses/oxygen-icons-AUTHORS.txt).

### Adobe Illustrator — SVGO fixtures

Source: [svg/svgo at `e4cb29bebcc9`](https://github.com/svg/svgo/tree/e4cb29bebcc9820ac979dfc05106b512cc5de986).
Both files identify Adobe Illustrator in their generator comments.

| Fixture                           | Upstream path                                                                                                                                          | Extraction               | Coverage                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------------------- |
| `illustrator/circle-and-text.svg` | [test/svg2js/test.svg](https://github.com/svg/svgo/blob/e4cb29bebcc9820ac979dfc05106b512cc5de986/test/svg2js/test.svg)                                 | Entire file, unchanged   | XML declaration, public DOCTYPE, CDATA, `xml:space`, text |
| `illustrator/styled-paths.svg`    | [test/plugins/inlineStyles.18.svg.txt](https://github.com/svg/svgo/blob/e4cb29bebcc9820ac979dfc05106b512cc5de986/test/plugins/inlineStyles.18.svg.txt) | Input before first `@@@` | CSS text, classes, multiline path attributes              |

License: MIT; see [SVGO license](licenses/svgo-MIT.txt).

### Figma — Bitcoin Icons

Source: [BitcoinDesign/Bitcoin-Icons at `bd5a9b033407`](https://github.com/BitcoinDesign/Bitcoin-Icons/tree/bd5a9b0334073d4bb8899effeb06bcc400127700).
The upstream [README](https://github.com/BitcoinDesign/Bitcoin-Icons/blob/bd5a9b0334073d4bb8899effeb06bcc400127700/README.md)
and [release process](https://github.com/BitcoinDesign/Bitcoin-Icons/blob/bd5a9b0334073d4bb8899effeb06bcc400127700/RELEASES.md)
describe the original Figma exports in `svg/`, separate from `optimized/`.
Files are copied unchanged from `svg/`.

| Fixture              | Upstream path                                                                                                                                   | Coverage                                           |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `figma/wallet.svg`   | [svg/outline/wallet.svg](https://github.com/BitcoinDesign/Bitcoin-Icons/blob/bd5a9b0334073d4bb8899effeb06bcc400127700/svg/outline/wallet.svg)   | Paths, rectangles, circles, stroke attributes      |
| `figma/contacts.svg` | [svg/filled/contacts.svg](https://github.com/BitcoinDesign/Bitcoin-Icons/blob/bd5a9b0334073d4bb8899effeb06bcc400127700/svg/filled/contacts.svg) | Filled paths, opacity                              |
| `figma/qr-code.svg`  | [svg/outline/qr-code.svg](https://github.com/BitcoinDesign/Bitcoin-Icons/blob/bd5a9b0334073d4bb8899effeb06bcc400127700/svg/outline/qr-code.svg) | Repeated elements, decimal attributes, child order |

License: MIT for these icons; see [license](licenses/bitcoin-icons-MIT.txt)
and [upstream licensing notice](licenses/bitcoin-icons-NOTICE.txt).
The separately licensed Bitcoin and Satoshi symbols are not included.

### SVGO regression inputs

Source: [svg/svgo at `e4cb29bebcc9`](https://github.com/svg/svgo/tree/e4cb29bebcc9820ac979dfc05106b512cc5de986).
Each file contains only the input before the first `@@@` separator, without
reformatting or optimizing it. The upstream expected optimization output and
plugin configuration are not part of the SVG input.

| Fixture                       | Upstream path                                                                                                                                                                    | Coverage                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `svgo/mixed-text.svg`         | [test/svgo/whitespaces.svg.txt](https://github.com/svg/svgo/blob/e4cb29bebcc9820ac979dfc05106b512cc5de986/test/svgo/whitespaces.svg.txt)                                         | Mixed text and `tspan`, significant whitespace   |
| `svgo/foreign-object.svg`     | [test/svgo/pre-element.svg.txt](https://github.com/svg/svgo/blob/e4cb29bebcc9820ac979dfc05106b512cc5de986/test/svgo/pre-element.svg.txt)                                         | XHTML namespace, `foreignObject`, multiline text |
| `svgo/unknown-attributes.svg` | [test/plugins/removeUnknownsAndDefaults.01.svg.txt](https://github.com/svg/svgo/blob/e4cb29bebcc9820ac979dfc05106b512cc5de986/test/plugins/removeUnknownsAndDefaults.01.svg.txt) | Unknown attributes, custom prefixes, `xml:space` |
| `svgo/comments.svg`           | [test/plugins/removeComments.01.svg.txt](https://github.com/svg/svgo/blob/e4cb29bebcc9820ac979dfc05106b512cc5de986/test/plugins/removeComments.01.svg.txt)                       | Comments at different nesting levels             |

License: MIT; see [SVGO license](licenses/svgo-MIT.txt).

## Adding fixtures

Use small files that you have the right to redistribute. Put them in the
appropriate source directory and document their original path, pinned source
version, license, any changes, and the behavior they exercise here. Preserve
source formatting. Include upstream notices and license texts for new sources.
For a new source directory, add it to `fixtureCorpora` in `test/corpus.test.ts`
so an empty or missing directory cannot pass silently.
