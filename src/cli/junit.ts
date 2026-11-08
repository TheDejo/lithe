import { relative, sep } from "path";
import type { TestResult } from "../core/runner";
import { formatStep } from "./report";

// Characters XML 1.0 does not allow, plus ANSI colour codes.
const INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const ANSI = /\x1b\[[0-9;]*m/g;

function xml(value: unknown): string {
  return String(value ?? "")
    .replace(ANSI, "")
    .replace(INVALID, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const seconds = (ms: number) => (ms / 1000).toFixed(3);

function errorText(e: unknown): { type: string; message: string; body: string } {
  if (e instanceof Error) {
    return { type: e.name, message: e.message.split("\n")[0], body: e.stack ?? `${e.name}: ${e.message}` };
  }
  return { type: "Error", message: String(e), body: String(e) };
}

/**
 * Build a JUnit XML report: one <testsuite> per test file, one <testcase> per
 * test. Failing tests carry their trace in <system-out>.
 */
export function buildJUnit(results: TestResult[], opts: { cwd: string; durationMs: number }): string {
  const byFile = new Map<string, TestResult[]>();
  for (const r of results) {
    const file = r.file ? relative(opts.cwd, r.file).split(sep).join("/") : "(unknown)";
    if (!byFile.has(file)) byFile.set(file, []);
    byFile.get(file)!.push(r);
  }

  const count = (rs: TestResult[], s: TestResult["status"][]) => rs.filter((r) => s.includes(r.status)).length;
  const timestamp = new Date().toISOString().replace(/\.\d+Z$/, "");
  const suites: string[] = [];

  for (const [file, rs] of byFile) {
    const time = rs.reduce((t, r) => t + r.duration, 0);
    const cases = rs.map((r) => {
      const name = r.path.join(" › ");
      const open = `    <testcase classname="${xml(file)}" name="${xml(name)}" time="${seconds(r.duration)}"`;
      if (r.status === "pass") return `${open} />`;
      if (r.status === "skip" || r.status === "todo") {
        return `${open}>\n      <skipped message="${r.status === "todo" ? "todo" : "skipped"}" />\n    </testcase>`;
      }
      const failures = r.errors.map((e) => {
        const t = errorText(e);
        return `      <failure message="${xml(t.message)}" type="${xml(t.type)}">${xml(t.body)}</failure>`;
      });
      const out: string[] = [];
      if (r.attempts > 1) out.push(`Failed after ${r.attempts} attempts.`);
      if (r.trace?.length) {
        out.push(`Trace (${r.trace.length} steps):`, ...r.trace.map((s, i) => `${i + 1}. +${s.at}ms ${formatStep(s)}`));
      }
      const sysout = out.length ? `\n      <system-out>${xml(out.join("\n"))}</system-out>` : "";
      return `${open}>\n${failures.join("\n")}${sysout}\n    </testcase>`;
    });
    suites.push(
      `  <testsuite name="${xml(file)}" tests="${rs.length}" failures="${count(rs, ["fail"])}" errors="0" ` +
        `skipped="${count(rs, ["skip", "todo"])}" time="${seconds(time)}" timestamp="${timestamp}">\n${cases.join("\n")}\n  </testsuite>`
    );
  }

  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<testsuites name="lithe" tests="${results.length}" failures="${count(results, ["fail"])}" errors="0" ` +
    `skipped="${count(results, ["skip", "todo"])}" time="${seconds(opts.durationMs)}">\n${suites.join("\n")}\n</testsuites>\n`
  );
}
