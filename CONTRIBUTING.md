# Contributing to Lithe

Thanks for helping make AI agents easier to test. Bug reports, feature ideas, docs fixes and code are all welcome.

## Reporting a bug or asking for a feature

[Open an issue](https://github.com/TheDejo/lithe/issues/new/choose). For bugs, the most useful things to include are:

- the Lithe version (`npx lithe --version`) and Node version (`node -v`)
- a small test file that shows the problem
- what you expected, and the output you got

## Making a change

1. Fork the repo and create a branch.
2. Install and run the tests:

   ```bash
   npm install
   npm test
   ```

   `npm test` builds, type-checks `src/`, `examples/` and `test/`, runs Lithe on its own tests, then runs the CLI integration tests.
3. Make your change, with tests:
   - Behaviour of `test`, `expect`, mocks or tracing: add a test in `test/*.test.ts` (written with Lithe itself).
   - CLI behaviour, exit codes or output: add a case to `test/cli.integration.mjs`, using a fixture in `test/fixtures/` (fixtures are named `*.fixture.ts` so they don't run as part of the normal suite).
   - New user-facing features: update the README.
4. Open a pull request describing what changed and why.

Run the CLI from source while you work, without building:

```bash
npm run dev -- examples
```

## Good first contributions

- New matchers that help with non-deterministic LLM output
- More integration examples (Vercel AI SDK, LangChain, LlamaIndex, ...)
- Improvements to failure messages and trace formatting
- Anything labelled [`good first issue`](https://github.com/TheDejo/lithe/labels/good%20first%20issue)

## Project layout

See [Developing Lithe](README.md#developing-lithe) in the README.
