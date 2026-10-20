# Contributing

Bug reports, feedback, and design discussions are welcome through [GitHub Issues](https://github.com/hexlabelposition/svg-serde/issues). Before implementing a feature, open an issue or comment on an existing one so that the design can be agreed on first.

## Development

The project uses [Bun](https://bun.sh/) for installing dependencies and running scripts. Use the latest Bun release, since older ones cannot read the lockfile, and Node.js 22 or later, which runs the tests and the build.

```sh
bun install
```

| Command                | What it does                                                 |
| ---------------------- | ------------------------------------------------------------ |
| `bun run lint`         | Lint with ESLint                                             |
| `bun run format`       | Format all files with Prettier (`format:check` only checks)  |
| `bun run typecheck`    | Type-check the library, the tests, and the scripts           |
| `bun run test`         | Run unit, property-based, and corpus tests on Node.js        |
| `bun run test:bun`     | Run the same tests on Bun                                    |
| `bun run test:browser` | Run the tests in Chromium, Firefox, and WebKit               |
| `bun run test:watch`   | Run the tests on Node.js in watch mode                       |
| `bun run build`        | Build `dist/` and validate the package with publint and attw |
| `bun run bench`        | Run benchmarks on Node.js (`bench:bun` for Bun)              |

Browser tests need Playwright's browsers and the system libraries they depend on:

```sh
bunx playwright install --with-deps chromium firefox webkit
```

`--with-deps` installs the libraries with `apt` on Debian and Ubuntu. On other systems, install them with the system package manager or rely on CI.

See the [benchmark guide](./scripts/benchmarks/README.md) before making claims about performance, and the [fixture catalog](./test/fixtures/README.md) before adding files to the test corpus.

## Conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat`, `fix`, `perf`, `docs`, `test`, `build`, `ci`, or `chore`, followed by a short summary in the imperative mood, such as `feat: add whitespace trim parse option`.
- Before opening a pull request, run `bun run lint`, `bun run format:check`, `bun run typecheck`, and `bun run test`. CI runs these and the Bun and browser tests on every pull request.
- Changes to `.github/` cannot be fully tested before they run, so check workflows with [actionlint](https://github.com/rhysd/actionlint). Actions are pinned to commit SHAs and updated by Dependabot.

## Releasing

Releases are published by the [release workflow](./.github/workflows/release.yml) when a version tag is pushed. Only maintainers can release.

1. Update `version` in `package.json` and commit only that change as `chore: release X.Y.Z`. CI skips commits with this message on `main`, since the release workflow checks the same commit.
2. Tag the commit and push both:

   ```sh
   git tag vX.Y.Z
   git push
   git push origin vX.Y.Z
   ```

3. The workflow checks that the tag matches the package version, runs the full CI, builds the package, stages it on npm, and creates a GitHub release with generated notes.
4. Approve the staged version on npmjs.com, or find it with `npm stage list svg-serde` and run `npm stage approve <stage-id>`. Approval requires two-factor authentication and is available once npm's malware scan has finished. **The version cannot be installed until it is approved.**

npm accepts releases only from the `npm` environment of the release workflow, which runs only for `v*` tags, and never publishes them directly.
