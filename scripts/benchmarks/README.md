# Benchmarks

Run from the repository root after installing the locked dependencies:

```sh
bun install --frozen-lockfile
bun run bench
bun run bench:bun
```

`bench` runs on Node.js; `bench:bun` runs on Bun. Both build the library first
and measure `dist/index.js`, the same entry point used by consumers. Benchmark
dependencies are development dependencies and are not shipped with the package.
The dedicated Vitest configuration keeps benchmarks separate from normal tests
and runs them sequentially with one worker.

## Operations

| Operation                            | svg-serde                  | svgson                         | svg-parser |
| ------------------------------------ | -------------------------- | ------------------------------ | ---------- |
| Parse a source string                | `parse()`                  | `parseSync()`                  | `parse()`  |
| Serialize a prepared tree            | `stringify()`              | `stringify()`                  | —          |
| Source string → tree → output string | `stringify(parse(source))` | `stringify(parseSync(source))` | —          |

All operations are synchronous and use default options, including compact output.
Each serializer receives its own library's tree, prepared before timing.
Round-trip measurements include both parsing and serialization. Input loading,
generation, hashing, tree preparation, and preflight checks are outside the timed
functions. The preflight checks validate svg-serde's round-trip equivalence and
ensure that the other libraries can parse the inputs and that svgson emits
well-formed XML for these files.

## Inputs

| Input                         | Source                                | Purpose                                |
| ----------------------------- | ------------------------------------- | -------------------------------------- |
| `figma/wallet`                | Checked-in Figma export               | Small icon                             |
| `inkscape/emblem-pause`       | Checked-in Inkscape export            | Editor namespaces, metadata, gradients |
| `illustrator/circle-and-text` | Checked-in Illustrator export         | Declaration, DOCTYPE, CDATA, text      |
| `generated/1000-rectangles`   | 1,000 groups, each with a rectangle   | Many elements and attributes           |
| `generated/10000-rectangles`  | 10,000 groups, each with a rectangle  | Larger object tree, about 1 MiB of XML |
| `generated/large-path`        | One path with a repeated path segment | About 1 MiB in a single attribute      |

Real-world inputs and their licenses are documented in
[the fixture catalog](../../test/fixtures/README.md). Generated inputs are
deterministic and are created by `svg.bench.ts`; they are synthetic workloads.
Every benchmark name includes the exact input size in UTF-8 bytes.

## Sampling and reports

The default is at least 500 ms and 20 iterations per measured function, preceded
by at least 250 ms and 5 warmup iterations. Tinybench, through Vitest, reports
latency and throughput statistics. Increase the measurement time for closer
comparisons:

```sh
BENCH_TIME_MS=2000 bun run bench
```

`BENCH_TIME_MS` must be a positive safe integer. Minimum iteration counts can
make runs longer than the time budgets, especially for large files.

Save results with Vitest's JSON reporter:

```sh
bun run bench --reporter=default --reporter=json --outputFile=benchmark-results/node.json
bun run bench:bun --reporter=default --reporter=json --outputFile=benchmark-results/bun.json
```

`benchmark-results/` is ignored by Git. Each JSON assertion result includes
`benchmarks` with measured statistics and `meta` with the runtime and
package versions, built library SHA-256, input size and SHA-256, and sampling
options. The build hash distinguishes uncommitted library changes that share
the same package version. Environment and sampling details are also printed
to the console. The benchmark collector does not query hardware or operating
system details.

Run Node.js and Bun sequentially on the same idle machine, keep dependencies
locked, and repeat measurements before drawing conclusions. Avoid concurrent
test runs, builds, profilers, and other CPU-intensive work during measurements.

## Interpreting comparisons

The libraries return different object models and do different work. svg-serde
validates XML and namespace prefixes, enforces resource limits, decodes entity
references, and preserves document-level constructs. svgson and svg-parser
have different validation and preservation behavior, as described in the main
[README comparison](../../README.md#comparison-with-alternatives).

These timings compare end-to-end API costs on identical valid inputs; they do
not establish equivalent output or correctness. Results on generated shapes
and a few editor exports cannot represent every SVG workload. Use the corpus
and property tests to validate correctness when optimizing. This suite measures
latency and throughput; memory usage needs separate profiling.

## XML character validation optimization

The XML character validator now matches forbidden code points directly instead
of negating the allowed ranges. Unicode mode continues to distinguish valid
surrogate pairs from lone surrogates. Tests check every Unicode code point
against the XML 1.0 `Char` production, plus malformed surrogate sequences.

For `generated/large-path` (1,114,170 bytes), paired measurements of `stringify()`
gave the following mean latencies. Ranges cover two runs with reversed order:

| Runtime        | Before         | After          | Speedup    |
| -------------- | -------------- | -------------- | ---------- |
| Node.js 26.8.1 | 0.819–0.821 ms | 0.442–0.443 ms | 1.85×      |
| Bun 1.4.0      | 0.601–0.611 ms | 0.117 ms       | 5.15–5.24× |

These are timings for a single synthetic workload. The
[measurement snapshot](./xml-characters.results.json) records build and input
hashes, sampling options, runtime and package versions, sample counts, and relative margins of
error. Baseline source: commit `8806a12`.

To reproduce the full-suite comparison, build that revision in a separate
checkout with locked dependencies, then run the JSON-report commands above on
both revisions. For a paired comparison, import both built ESM entry points
into one benchmark process and pass the same prepared tree to each serializer.
Use `bench.compare()` with the snapshot's sampling options, then repeat with
the registration order reversed. Paired measurements reduce the effect of
changing conditions between separate runs.

## Tree building and name validation optimization

CPU profiles of `parse()` show that most time is spent in the saxes tokenizer;
svg-serde's own share was mostly copying attributes from each saxes tag through
`Object.entries()`. Attributes are now copied with `for...in`. Each element's
`children` array is also copied to its exact length when the element closes:
growing arrays reserve spare capacity, which made up about a quarter of the
tree's memory in documents where most elements have one child.

In `stringify()`, names are validated against a large Unicode pattern. Valid
names are now cached in a set of at most 1,024 entries, which is cleared when
full, since documents repeat a few names many times. Collecting output in an
array of parts instead of concatenating strings was slower and was not kept.

Retained heap after parsing 100,000 groups with a rectangle (9.6M characters)
went from 281 to 216 bytes per element (56.2 MB to 43.3 MB). Median latencies
from a paired comparison, alternating both builds in one process:

| Input                         | Node.js parse | Node.js stringify | Bun parse | Bun stringify |
| ----------------------------- | ------------- | ----------------- | --------- | ------------- |
| `figma/wallet`                | 1.07×         | 1.13×             | 1.11×     | 1.45×         |
| `inkscape/emblem-pause`       | 1.06×         | 1.45×             | 1.08×     | 1.48×         |
| `illustrator/circle-and-text` | 1.05×         | 1.12×             | 1.03×     | 1.36×         |
| `generated/1000-rectangles`   | 1.12×         | 1.22×             | 1.14×     | 1.58×         |
| `generated/10000-rectangles`  | 1.14×         | 1.22×             | 1.13×     | 1.34×         |
| `generated/large-path`        | 1.00×         | 0.99×             | 1.00×     | 1.01×         |

Speedups are relative to commit `5c2157e`, measured on Node.js 26.8.1 and
Bun 1.4.0. The large path has a single attribute, so neither change
applies to it. Disabling the saxes namespace mode would save about another 10%
of parse time, but svg-serde would then have to reimplement namespace
well-formedness checks, so the mode was kept.

saxes has since been replaced by a built-in tokenizer, so the profile above
describes the parser as it was at the time.
