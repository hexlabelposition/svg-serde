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
`benchmarks` with measured statistics and `meta` with the runtime, OS, CPU,
package versions, built library SHA-256, input size and SHA-256, and sampling
options. The build hash distinguishes uncommitted library changes that share
the same package version. Environment and sampling details are also printed
to the console.

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
