import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import { relative, sep } from "path";
import type { Status, TestResult } from "../core/runner";
import type { TraceEvent } from "../core/trace";

/**
 * A durable record of one test run: what ran, against which commit, what
 * passed or failed, and the step-by-step trace of each test. Keep these as
 * CI artifacts so a person or another agent can later work out *why*
 * behaviour changed, and diff two of them with `lithe compare`.
 */
export interface Report {
  schema: 1;
  lithe: string;
  createdAt: string;
  durationMs: number;
  node: string;
  git?: { commit?: string; branch?: string; dirty?: boolean };
  ci?: { runUrl?: string };
  summary: Record<Status, number> & { total: number };
  tests: ReportTest[];
}

export interface ReportTest {
  /** Stable identifier: "<file> > <describe> > <test>". */
  id: string;
  file?: string;
  name: string[];
  status: Status;
  durationMs: number;
  attempts: number;
  errors: { name: string; message: string; stack?: string }[];
  trace?: TraceEvent[];
}

function git(args: string[], cwd: string): string | undefined {
  try {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 3000 });
    return r.status === 0 ? r.stdout.trim() : undefined;
  } catch {
    return undefined;
  }
}

function gitInfo(cwd: string): Report["git"] {
  const env = process.env;
  const commit = env.GITHUB_SHA ?? env.CI_COMMIT_SHA ?? env.CIRCLE_SHA1 ?? git(["rev-parse", "HEAD"], cwd);
  const branch =
    env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || env.CI_COMMIT_REF_NAME || env.CIRCLE_BRANCH ||
    git(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  const status = git(["status", "--porcelain"], cwd);
  if (!commit && !branch) return undefined;
  return { commit, branch, dirty: status === undefined ? undefined : status.length > 0 };
}

function ciInfo(): Report["ci"] {
  const { GITHUB_SERVER_URL, GITHUB_REPOSITORY, GITHUB_RUN_ID, CI_JOB_URL, CIRCLE_BUILD_URL } = process.env;
  const runUrl = GITHUB_RUN_ID
    ? `${GITHUB_SERVER_URL ?? "https://github.com"}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`
    : CI_JOB_URL ?? CIRCLE_BUILD_URL;
  return runUrl ? { runUrl } : undefined;
}

function serializeError(e: unknown): ReportTest["errors"][number] {
  if (e instanceof Error) return { name: e.name, message: e.message, stack: e.stack };
  return { name: "NonError", message: String(e) };
}

export function buildReport(results: TestResult[], opts: { cwd: string; version: string; durationMs: number }): Report {
  const summary = { pass: 0, fail: 0, skip: 0, todo: 0, total: results.length };
  const tests = results.map((r): ReportTest => {
    summary[r.status]++;
    const file = r.file ? relative(opts.cwd, r.file).split(sep).join("/") : undefined;
    return {
      id: [file ?? "", ...r.path].join(" > "),
      file,
      name: r.path,
      status: r.status,
      durationMs: Math.round(r.duration),
      attempts: r.attempts,
      errors: r.errors.map(serializeError),
      trace: r.trace,
    };
  });
  return {
    schema: 1,
    lithe: opts.version,
    createdAt: new Date().toISOString(),
    durationMs: Math.round(opts.durationMs),
    node: process.version,
    git: gitInfo(opts.cwd),
    ci: ciInfo(),
    summary,
    tests,
  };
}

export function readReport(path: string): Report {
  const data = JSON.parse(readFileSync(path, "utf8"));
  if (!data || data.schema !== 1 || !Array.isArray(data.tests)) {
    throw new Error(`${path} is not a lithe report (generate one with: lithe --report ${path})`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Formatting trace steps
// ---------------------------------------------------------------------------

function short(value: unknown, max = 100): string {
  let s: string;
  try {
    s = typeof value === "string" ? JSON.stringify(value) : JSON.stringify(value) ?? "undefined";
  } catch {
    s = String(value);
  }
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function formatStep(e: TraceEvent): string {
  if (e.type === "note") return `note: ${e.name}${e.data === undefined ? "" : " " + short(e.data)}`;
  const args = (e.input ?? []).map((a) => short(a, 60)).join(", ");
  const result = e.error !== undefined ? `threw ${short(e.error)}` : `→ ${short(e.output)}`;
  return `${e.name}(${args}) ${result}`;
}

// ---------------------------------------------------------------------------
// Comparing two reports
// ---------------------------------------------------------------------------

/** What a step "means", ignoring timing, so traces from different runs can be compared. */
function stepKey(e: TraceEvent): string {
  return JSON.stringify([e.type, e.name, e.input, e.output, e.error, e.data]);
}

export interface Divergence {
  index: number;
  before?: TraceEvent;
  after?: TraceEvent;
}

export function firstDivergence(a: TraceEvent[] = [], b: TraceEvent[] = []): Divergence | undefined {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (!a[i] || !b[i] || stepKey(a[i]) !== stepKey(b[i])) return { index: i, before: a[i], after: b[i] };
  }
  return undefined;
}

export interface TestChange {
  id: string;
  kind: "broke" | "fixed" | "status" | "behaviour" | "added" | "removed";
  before?: ReportTest;
  after?: ReportTest;
  divergence?: Divergence;
}

export function compareReports(before: Report, after: Report): TestChange[] {
  const a = new Map(before.tests.map((t) => [t.id, t]));
  const b = new Map(after.tests.map((t) => [t.id, t]));
  const changes: TestChange[] = [];

  for (const [id, t2] of b) {
    const t1 = a.get(id);
    if (!t1) {
      changes.push({ id, kind: "added", after: t2 });
      continue;
    }
    const divergence = firstDivergence(t1.trace, t2.trace);
    if (t1.status !== t2.status) {
      const kind = t1.status === "pass" && t2.status === "fail" ? "broke"
        : t1.status === "fail" && t2.status === "pass" ? "fixed" : "status";
      changes.push({ id, kind, before: t1, after: t2, divergence });
    } else if (divergence) {
      changes.push({ id, kind: "behaviour", before: t1, after: t2, divergence });
    }
  }
  for (const [id, t1] of a) if (!b.has(id)) changes.push({ id, kind: "removed", before: t1 });

  const order: TestChange["kind"][] = ["broke", "status", "behaviour", "fixed", "added", "removed"];
  return changes.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind));
}
