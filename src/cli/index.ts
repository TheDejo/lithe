#!/usr/bin/env node

import { Command, InvalidArgumentError } from "commander";
import { pathToFileURL } from "url";
import { run, DEFAULT_TIMEOUT, TestResult } from "../core/runner";
import { resetRegistry } from "../core/registry";
import { discover } from "./discover";
import { Reporter, c } from "./reporter";
import { buildReport, compareReports, formatStep, readReport, TestChange } from "./report";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";

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
  report?: string;
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
  const started = performance.now();
  const all: TestResult[] = [];
  let failed = false;

  for (const file of files) {
    reporter.fileStart(file);
    resetRegistry();
    try {
      await import(pathToFileURL(file).href);
    } catch (err) {
      reporter.fileError(file, err);
      all.push({ file, path: ["(failed to load test file)"], status: "fail", duration: 0, attempts: 0, errors: [err] });
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
    all.push(...results);
    if (results.some((r) => r.status === "fail")) {
      failed = true;
      if (opts.bail) break;
    }
  }

  const ok = reporter.finish();

  if (opts.report) {
    const out = resolve(cwd, opts.report);
    const report = buildReport(all, { cwd, version, durationMs: performance.now() - started });
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
    console.log(c.gray(`Report written to ${opts.report}`));
  }

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
  .option("--report <file>", "write a JSON record of the run (results, errors, traces, git commit) to <file>")
  .action(async (patterns: string[], opts: CliOptions) => {
    const code = await main(patterns, opts);
    // Exit explicitly: agents under test often leave sockets/timers open.
    process.exit(code);
  });

const LABELS: Record<TestChange["kind"], string> = {
  broke: c.red("✗ now failing"),
  status: c.yellow("~ status changed"),
  behaviour: c.yellow("~ behaviour changed"),
  fixed: c.green("✓ now passing"),
  added: c.cyan("+ added"),
  removed: c.gray("- removed"),
};

function compare(beforePath: string, afterPath: string): number {
  const before = readReport(beforePath);
  const after = readReport(afterPath);
  const describe = (r: typeof before) =>
    [r.git?.commit?.slice(0, 7), r.git?.branch, r.createdAt].filter(Boolean).join(" · ");
  console.log(`${c.bold("Before:")} ${beforePath} ${c.gray(describe(before))}`);
  console.log(`${c.bold("After: ")} ${afterPath} ${c.gray(describe(after))}`);

  const changes = compareReports(before, after);
  if (!changes.length) {
    console.log("\nNo changes: same tests, same results, same traces.");
    return 0;
  }

  for (const ch of changes) {
    const status = ch.before && ch.after && ch.before.status !== ch.after.status
      ? c.gray(` (${ch.before.status} → ${ch.after.status})`) : "";
    console.log(`\n${LABELS[ch.kind]}  ${ch.id}${status}`);
    const d = ch.divergence;
    if (d) {
      console.log(c.gray(`   first difference at step ${d.index + 1}:`));
      console.log(`   ${c.red("- " + (d.before ? formatStep(d.before) : "(no step)"))}`);
      console.log(`   ${c.green("+ " + (d.after ? formatStep(d.after) : "(no step)"))}`);
    }
    const err = ch.kind === "broke" || ch.kind === "status" ? ch.after?.errors[0] : undefined;
    if (err) console.log(c.gray(`   error: ${err.message.split("\n")[0]}`));
  }

  const count = (k: TestChange["kind"]) => changes.filter((x) => x.kind === k).length;
  console.log(
    `\n${changes.length} change(s): ${count("broke")} now failing, ${count("fixed")} now passing, ` +
    `${count("behaviour") + count("status")} changed, ${count("added")} added, ${count("removed")} removed`
  );
  return count("broke") > 0 ? 1 : 0;
}

program
  .command("compare")
  .description("Compare two --report files: which tests changed, and the first step where each agent's behaviour diverged")
  .argument("<before>", "report from the earlier run (e.g. main)")
  .argument("<after>", "report from the later run (e.g. your branch)")
  .action((beforePath: string, afterPath: string) => {
    try {
      process.exit(compare(beforePath, afterPath));
    } catch (e) {
      console.error(c.red((e as Error).message));
      process.exit(2);
    }
  });

program.parseAsync().catch((err) => {
  console.error(err);
  process.exit(1);
});
