import { spawn } from "child_process";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { availableParallelism, cpus, tmpdir } from "os";
import { join } from "path";
import type { TestResult } from "../core/runner";
import type { Reporter } from "./reporter";

/** Environment variable that turns a CLI process into a worker for one file. */
export const WORKER_ENV = "LITHE_WORKER_RESULTS";

export function parseJobs(value: string): number {
  if (value === "auto") return Math.max(1, (availableParallelism?.() ?? cpus().length) - 1 || 1);
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error('--jobs must be a positive whole number or "auto"');
  return n;
}

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

type WireResult = Omit<TestResult, "errors"> & { errors: SerializedError[] };

export function serializeResults(results: TestResult[]): WireResult[] {
  return results.map((r) => ({
    ...r,
    errors: r.errors.map((e) =>
      e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : { name: "NonError", message: String(e) }
    ),
  }));
}

function revive(results: WireResult[]): TestResult[] {
  return results.map((r) => ({
    ...r,
    errors: r.errors.map((e) => {
      const err = new Error(e.message);
      err.name = e.name;
      err.stack = e.stack ?? `${e.name}: ${e.message}`;
      return err;
    }),
  }));
}

export interface ParallelOptions {
  files: string[];
  jobs: number;
  cliPath: string;
  /** CLI arguments every worker gets (timeout, retries, -t, --setup, --record...). */
  workerArgs: string[];
  bail?: boolean;
  reporter: Reporter;
}

/**
 * Run each test file in its own worker process, up to `jobs` at a time.
 * Each file's output is printed as one block when the file finishes, so output
 * from different files never interleaves.
 */
export async function runParallel(opts: ParallelOptions): Promise<{ results: TestResult[]; failed: boolean }> {
  const queue = [...opts.files];
  const all: TestResult[] = [];
  const dir = mkdtempSync(join(tmpdir(), "lithe-workers-"));
  let failed = false;
  let stopped = false;
  let n = 0;

  const colour = process.stdout.isTTY && !process.env.NO_COLOR ? { FORCE_COLOR: "1" } : {};

  const runOne = (file: string) =>
    new Promise<void>((done) => {
      const out = join(dir, `${n++}.json`);
      const child = spawn(process.execPath, [opts.cliPath, file, ...opts.workerArgs], {
        env: { ...process.env, ...colour, [WORKER_ENV]: out },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let text = "";
      child.stdout.on("data", (d) => (text += d));
      child.stderr.on("data", (d) => (text += d));
      child.on("close", (code) => {
        opts.reporter.write(text);
        let results: TestResult[];
        try {
          results = revive(JSON.parse(readFileSync(out, "utf8")));
        } catch {
          const err = new Error(`The worker running this file exited with code ${code} without reporting results.`);
          results = [{ file, path: ["(worker crashed)"], status: "fail", duration: 0, attempts: 0, errors: [err] }];
        }
        for (const r of results) opts.reporter.absorb(r);
        opts.reporter.fileEnd(results);
        all.push(...results);
        if (results.some((r) => r.status === "fail")) {
          failed = true;
          if (opts.bail) stopped = true;
        }
        done();
      });
    });

  const worker = async () => {
    while (queue.length && !stopped) await runOne(queue.shift()!);
  };

  try {
    await Promise.all(Array.from({ length: Math.min(opts.jobs, opts.files.length) }, worker));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Keep results in file order, whatever order the files finished in.
  const order = new Map(opts.files.map((f, i) => [f, i]));
  all.sort((a, b) => (order.get(a.file ?? "") ?? 0) - (order.get(b.file ?? "") ?? 0));
  return { results: all, failed };
}
