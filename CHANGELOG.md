# Changelog

All notable changes to Lithe are listed here.

Lithe follows [semantic versioning](https://semver.org). Until 1.0, a minor version (0.x.0) may include breaking changes; they are always listed under **Changed** with what to do. Patch versions (0.x.y) only fix bugs.

## 0.6.1 (unreleased)

### Changed
- File paths in output always use forward slashes, on every operating system. `--list` now prints paths relative to the current folder instead of absolute paths.

### Added
- CI now runs on Linux, macOS and Windows, with Node 20 and 22.
- `npm run test:live` (and a "Live checks" workflow) runs judges, embeddings and record and replay against the real Anthropic and OpenAI APIs.
- This changelog.

## 0.6.0 (2026-11-08)

### Added
- `-j, --jobs <n>` runs test files in parallel, each in its own process. Output stays grouped by file, and failures, the summary, `--report` and `--junit` cover every file. `--jobs auto` uses CPU cores minus one.

## 0.5.0 (2026-11-08)

### Added
- Record and replay: `recorded(name, fn)` saves real responses with `--record` and replays them on later runs. `--rerecord` refreshes them.
- Watch mode: `--watch` (`-w`) re-runs the tests when a file changes.
- JUnit reports: `--junit <file>` writes JUnit XML for CI dashboards, with traces on failing tests.

## 0.4.0 (2026-11-08)

### Added
- Semantic assertions: `toMean(reference)` and `toMeetCriteria(criteria)` ask an LLM judge; `toBeSimilarTo(text, { threshold })` compares embeddings.
- `configure({ judge, embed })` connects Lithe to any model provider.
- `--setup <file>` loads files before the tests.
- An async assertion that isn't awaited now fails its test with a reminder, instead of passing silently.

## 0.3.1 (2026-11-07)

### Added
- Examples for agents built on the Anthropic and OpenAI SDKs, tested by stubbing the real clients with `spyOn`.
- Type-checking of examples and tests as part of `npm test`.

## 0.3.0 (2026-11-07)

### Added
- Traces: `traced()`, named mocks (`fn().mockName()`) and `note()` record each step of a test. Failing tests print their trace.
- `--report <file>` writes a JSON record of the run, including traces and the git commit.
- `lithe compare <before> <after>` shows which tests changed and the first step where behaviour diverged.

## 0.2.0 (2026-11-07)

The first working release.

### Added
- Test discovery, TypeScript and ESM test files with no config, and a non-zero exit code on failure.
- `describe` / `test` / `it` with `.only`, `.skip`, `.todo`, and before/after hooks.
- Per-test timeouts and retries.
- `expect` with deep equality, `.not`, `.resolves` / `.rejects`, AI-friendly matchers (`toContainAny`, `toContainAll`, `toBeOneOf`, `toBeJSON`, `toSatisfy`) and asymmetric matchers.
- Mocks: `fn()` and `spyOn()`.
- An automated npm release workflow.

### Fixed
- The published package now contains a working `lithe` command (0.1.x pointed at files that didn't exist).

## 0.1.0 – 0.1.1

Early versions. Not functional; please upgrade.
