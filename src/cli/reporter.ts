import { sep } from "path";
import { displayPath } from "./paths";
import { inspect } from "util";
import type { TestResult } from "../core/runner";
import { formatStep } from "./report";

const useColor = process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb"
  || !!process.env.FORCE_COLOR;

const paint = (code: number) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
export const c = {
  green: paint(32),
  red: paint(31),
  yellow: paint(33),
  cyan: paint(36),
  gray: paint(90),
  bold: paint(1),
};

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

export class Reporter {
  private failures: TestResult[] = [];
  private counts = { pass: 0, fail: 0, skip: 0, todo: 0 };
  private files = { pass: 0, fail: 0 };
  private start = performance.now();

  constructor(private cwd: string, private log: (s: string) => void = (s) => console.log(s)) {}

  fileStart(file: string) {
    this.log("\n" + c.bold(displayPath(this.cwd, file)));
  }

  fileEnd(results: TestResult[], loadError?: unknown) {
    if (loadError || results.some((r) => r.status === "fail")) this.files.fail++;
    else this.files.pass++;
  }

  fileError(file: string, error: unknown) {
    const result: TestResult = { file, path: ["(failed to load test file)"], status: "fail", duration: 0, attempts: 0, errors: [error] };
    this.result(result);
  }

  /** Count a result that was already printed elsewhere (by a parallel worker). */
  absorb(r: TestResult) {
    this.counts[r.status]++;
    if (r.status === "fail") this.failures.push(r);
  }

  /** Print text produced by a parallel worker, as one block. */
  write(text: string) {
    if (text) this.log(text.replace(/\n+$/, ""));
  }

  suiteStart(path: string[]) {
    this.log(`${"  ".repeat(path.length)}${path[path.length - 1]}`);
  }

  result(r: TestResult) {
    this.counts[r.status]++;
    const indent = "  ".repeat(r.path.length);
    const name = r.path[r.path.length - 1];
    const time = r.duration >= 50 ? c.gray(` (${ms(r.duration)})`) : "";
    const retried = r.attempts > 1 ? c.yellow(` [${r.attempts} attempts]`) : "";
    switch (r.status) {
      case "pass":
        this.log(`${indent}${c.green("✓")} ${name}${time}${retried}`);
        break;
      case "fail":
        this.failures.push(r);
        this.log(`${indent}${c.red("✗")} ${c.red(name)}${time}${retried}`);
        break;
      case "skip":
        this.log(`${indent}${c.yellow("○")} ${c.gray(name)} ${c.gray("(skipped)")}`);
        break;
      case "todo":
        this.log(`${indent}${c.cyan("✎")} ${c.gray(name)} ${c.gray("(todo)")}`);
        break;
    }
  }

  /** Prints failure details and the summary. Returns true if everything passed. */
  finish(): boolean {
    if (this.failures.length) {
      this.log("\n" + c.red(c.bold(`Failures (${this.failures.length}):`)));
      this.failures.forEach((f, i) => {
        const where = f.file ? c.gray(`  ${displayPath(this.cwd, f.file)}`) : "";
        this.log(`\n${c.red(`${i + 1}) ${f.path.join(" › ")}`)}${where}`);
        for (const e of f.errors) this.log(indentBlock(formatError(e, this.cwd), "   "));
        if (f.trace?.length) this.log(indentBlock(formatTrace(f.trace), "   "));
      });
    }

    const { pass, fail, skip, todo } = this.counts;
    const parts = [
      fail && c.red(`${fail} failed`),
      pass && c.green(`${pass} passed`),
      skip && c.yellow(`${skip} skipped`),
      todo && c.cyan(`${todo} todo`),
    ].filter(Boolean);
    const total = pass + fail + skip + todo;
    const fileParts = [
      this.files.fail && c.red(`${this.files.fail} failed`),
      this.files.pass && c.green(`${this.files.pass} passed`),
    ].filter(Boolean);

    this.log("");
    this.log(`${c.bold("Test files:")} ${fileParts.join(", ") || "0"} (${this.files.pass + this.files.fail})`);
    this.log(`${c.bold("Tests:     ")} ${parts.join(", ") || "0"} (${total})`);
    this.log(`${c.bold("Time:      ")} ${ms(performance.now() - this.start)}`);
    return fail === 0;
  }
}

const TRACE_TAIL = 15;

function formatTrace(trace: NonNullable<TestResult["trace"]>): string {
  const shown = trace.slice(-TRACE_TAIL);
  const lines = [
    "",
    c.bold(`Trace (${trace.length} step${trace.length === 1 ? "" : "s"}${trace.length > TRACE_TAIL ? `, last ${TRACE_TAIL} shown` : ""}):`),
    ...shown.map((e, i) => {
      const n = trace.length - shown.length + i + 1;
      return `${c.gray(`${String(n).padStart(3)}. +${e.at}ms`)} ${e.type === "note" ? c.cyan(formatStep(e)) : formatStep(e)}`;
    }),
  ];
  return lines.join("\n");
}

function indentBlock(s: string, pad: string) {
  return s.split("\n").map((l) => pad + l).join("\n");
}

export function formatError(e: unknown, cwd: string): string {
  if (!(e instanceof Error)) return `Thrown non-error value: ${inspect(e)}`;
  const isAssertion = e.name === "AssertionError";
  const header = isAssertion ? e.message : `${e.name}: ${e.message}`;
  const frames = (e.stack ?? "")
    .split("\n")
    .filter((l) => /^\s+at /.test(l))
    .filter((l) => !/node:internal|new Promise \(<anonymous>\)|node_modules[\\/](tsx|commander)|[\\/]lithe[\\/](dist|src)[\\/](core|cli)[\\/]/.test(l))
    .slice(0, 4)
    .map((l) => c.gray(l.trim().split(cwd + sep).join("").split(cwd + "/").join("")));
  return [header, ...(frames.length ? ["", ...frames] : [])].join("\n");
}
