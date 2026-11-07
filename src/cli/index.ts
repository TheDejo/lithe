#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import { pathToFileURL } from "url";
import { run, DEFAULT_TIMEOUT, TestResult } from "../core/runner";
import { resetRegistry } from "../core/registry";
import { discover } from "./discover";
import { Reporter, c } from "./reporter";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { version } = require("../../package.json");

function int(value: string) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("must be a non-negative integer");
  return n;
}

let tsRegistered = false;
async function registerTypeScript() {
  if (tsRegistered) return;
  tsRegistered = true;
  // tsx lets test files be written in TypeScript (CJS or ESM) with no setup.
  const cjs = await import("tsx/cjs/api");
  cjs.register();
  const esm = await import("tsx/esm/api");
  esm.register();
}

interface CliOptions {
  testNamePattern?: string;
  timeout: number;
  retries: number;
  bail?: boolean;
  list?: boolean;
}

async function main(patterns: string[], opts: CliOptions): Promise<number> {
  const cwd = process.cwd();
  const files = discover(cwd, patterns);

  if (opts.list) {
    files.forEach((f) => console.log(f));
    return 0;
  }

  if (!files.length) {
    console.error(c.yellow("No test files found.") +
      c.gray(` Looked for *.test.* / *.spec.* files${patterns.length ? ` matching: ${patterns.join(" ")}` : ` under ${cwd}`}`));
    return 1;
  }

  await registerTypeScript();

  let namePattern: RegExp | undefined;
  if (opts.testNamePattern) {
    try {
      namePattern = new RegExp(opts.testNamePattern, "i");
    } catch (e) {
      console.error(c.red(`Invalid --test-name-pattern: ${(e as Error).message}`));
      return 1;
    }
  }

  const reporter = new Reporter(cwd);
  let failed = false;

  for (const file of files) {
    reporter.fileStart(file);
    resetRegistry();
    try {
      await import(pathToFileURL(file).href);
    } catch (err) {
      reporter.fileError(file, err);
      reporter.fileEnd([], err);
      failed = true;
      if (opts.bail) break;
      continue;
    }

    const results: TestResult[] = await run({
      file,
      timeout: opts.timeout,
      retries: opts.retries,
      testNamePattern: namePattern,
      bail: opts.bail,
      onResult: (r) => reporter.result(r),
      onSuiteStart: (p) => reporter.suiteStart(p),
    });
    reporter.fileEnd(results);
    if (results.some((r) => r.status === "fail")) {
      failed = true;
      if (opts.bail) break;
    }
  }

  const ok = reporter.finish();
  return ok && !failed ? 0 : 1;
}

const program = new Command();

program
  .name("lithe")
  .description("Test runner for AI agents")
  .version(version);

program
  .command("test", { isDefault: true })
  .description("Run test files (default: every *.test.* / *.spec.* file under the current directory)")
  .argument("[patterns...]", "files, directories, or path patterns to run")
  .option("-t, --test-name-pattern <regex>", "only run tests whose full name matches")
  .option("--timeout <ms>", "default timeout per test and hook", int, DEFAULT_TIMEOUT)
  .option("--retries <n>", "retry failing tests up to n times (useful for flaky LLM calls)", int, 0)
  .option("--bail", "stop after the first failing test")
  .option("--list", "list the test files that would run, then exit")
  .action(async (patterns: string[], opts: CliOptions) => {
    const code = await main(patterns, opts);
    // Exit explicitly: agents under test often leave sockets/timers open.
    process.exit(code);
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
