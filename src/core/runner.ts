import { getRoot, hasOnly, HookFn, resetRegistry, Suite, TestCase } from "./registry";

export type Status = "pass" | "fail" | "skip" | "todo";

export interface TestResult {
  file?: string;
  /** Names from the outermost describe down to the test itself. */
  path: string[];
  status: Status;
  duration: number;
  attempts: number;
  errors: unknown[];
}

export interface RunOptions {
  /** Default per-test / per-hook timeout in ms. */
  timeout?: number;
  /** Default number of retries for failing tests. */
  retries?: number;
  /** Only run tests whose full name ("describe > test") matches this. */
  testNamePattern?: RegExp;
  /** Stop after the first failure. */
  bail?: boolean;
  /** Called after each test finishes. */
  onResult?: (result: TestResult) => void;
  /** Called when entering a describe block that has tests to report. */
  onSuiteStart?: (path: string[]) => void;
}

export const DEFAULT_TIMEOUT = 5000;

class TimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(`${what} timed out after ${ms}ms`);
    this.name = "TimeoutError";
  }
}

// Errors that escape a test (unhandled rejections, uncaught exceptions in
// timers) get routed to whatever is currently running.
let currentFail: ((err: unknown) => void) | undefined;
let stray: unknown[] = [];

function onStray(err: unknown) {
  if (currentFail) currentFail(err);
  else stray.push(err);
}

function withTimeout(fn: HookFn | (() => unknown), ms: number, what: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const done = (err?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      currentFail = undefined;
      err === undefined ? resolve() : reject(err);
    };
    const timer = ms > 0 && Number.isFinite(ms) ? setTimeout(() => done(new TimeoutError(what, ms)), ms) : undefined;
    currentFail = (err) => done(err ?? new Error("Unknown error"));
    try {
      Promise.resolve(fn()).then(() => done(), (e) => done(e ?? new Error("Promise rejected with no reason")));
    } catch (e) {
      done(e ?? new Error("Thrown undefined"));
    }
  });
}

function suitePath(suite: Suite): string[] {
  const names: string[] = [];
  for (let s: Suite | undefined = suite; s && s.parent; s = s.parent) names.unshift(s.name);
  return names;
}

function ancestors(suite: Suite): Suite[] {
  const list: Suite[] = [];
  for (let s: Suite | undefined = suite; s; s = s.parent) list.unshift(s);
  return list;
}

interface Ctx {
  opts: Required<Pick<RunOptions, "timeout" | "retries">> & RunOptions;
  file?: string;
  onlyMode: boolean;
  results: TestResult[];
  bailed: boolean;
}

/** Decide whether a test should actually run, given .only/.skip and the name filter. */
function effectiveStatus(test: TestCase, ctx: Ctx): "run" | "skip" | "todo" {
  if (test.mode === "todo") return "todo";
  let skipped = test.mode === "skip";
  let only = test.mode === "only";
  for (let s: Suite | undefined = test.parent; s; s = s.parent) {
    if (s.mode === "skip") skipped = true;
    if (s.mode === "only") only = true;
  }
  if (skipped || ctx.bailed) return "skip";
  if (ctx.onlyMode && !only) return "skip";
  if (ctx.opts.testNamePattern) {
    const full = [...suitePath(test.parent), test.name].join(" > ");
    if (!ctx.opts.testNamePattern.test(full)) return "skip";
  }
  return "run";
}

function countRunnable(suite: Suite, ctx: Ctx): number {
  let n = 0;
  for (const c of suite.children) {
    n += c.kind === "suite" ? countRunnable(c, ctx) : effectiveStatus(c, ctx) === "run" ? 1 : 0;
  }
  return n;
}

function record(ctx: Ctx, r: Omit<TestResult, "file">) {
  const result = { file: ctx.file, ...r };
  ctx.results.push(result);
  if (result.status === "fail" && ctx.opts.bail) ctx.bailed = true;
  ctx.opts.onResult?.(result);
}

async function runHooks(hooks: HookFn[], ctx: Ctx, what: string): Promise<unknown[]> {
  const errors: unknown[] = [];
  for (const h of hooks) {
    try {
      await withTimeout(h, ctx.opts.timeout, what);
    } catch (e) {
      errors.push(e);
      break;
    }
  }
  return errors;
}

async function runTest(test: TestCase, ctx: Ctx): Promise<void> {
  const path = [...suitePath(test.parent), test.name];
  const status = effectiveStatus(test, ctx);
  if (status !== "run" || !test.fn) {
    record(ctx, { path, status: status === "run" ? "todo" : status, duration: 0, attempts: 0, errors: [] });
    return;
  }

  const chain = ancestors(test.parent);
  const timeout = test.options.timeout ?? ctx.opts.timeout;
  const maxAttempts = 1 + Math.max(0, test.options.retries ?? ctx.opts.retries);
  const start = performance.now();
  let errors: unknown[] = [];
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;
    errors = [];
    for (const s of chain) {
      errors.push(...(await runHooks(s.hooks.beforeEach, ctx, "beforeEach hook")));
      if (errors.length) break;
    }
    if (!errors.length) {
      try {
        await withTimeout(test.fn, timeout, `Test "${test.name}"`);
      } catch (e) {
        errors.push(e);
      }
    }
    for (const s of [...chain].reverse()) {
      errors.push(...(await runHooks(s.hooks.afterEach, ctx, "afterEach hook")));
    }
    if (!errors.length) break;
  }

  record(ctx, {
    path,
    status: errors.length ? "fail" : "pass",
    duration: performance.now() - start,
    attempts,
    errors,
  });
}

function failAll(suite: Suite, ctx: Ctx, errors: unknown[]) {
  for (const c of suite.children) {
    if (c.kind === "suite") failAll(c, ctx, errors);
    else if (effectiveStatus(c, ctx) === "run") {
      record(ctx, { path: [...suitePath(suite), c.name], status: "fail", duration: 0, attempts: 0, errors });
    } else {
      record(ctx, { path: [...suitePath(suite), c.name], status: effectiveStatus(c, ctx) as Status, duration: 0, attempts: 0, errors: [] });
    }
  }
}

async function runSuite(suite: Suite, ctx: Ctx): Promise<void> {
  const runnable = countRunnable(suite, ctx);
  if (suite.parent && suite.children.length) ctx.opts.onSuiteStart?.(suitePath(suite));

  if (runnable > 0) {
    const errs = await runHooks(suite.hooks.beforeAll, ctx, "beforeAll hook");
    if (errs.length) {
      failAll(suite, ctx, errs);
      await runHooks(suite.hooks.afterAll, ctx, "afterAll hook");
      return;
    }
  }

  for (const child of suite.children) {
    if (child.kind === "suite") await runSuite(child, ctx);
    else await runTest(child, ctx);
  }

  if (runnable > 0) {
    const errs = await runHooks(suite.hooks.afterAll, ctx, "afterAll hook");
    if (errs.length) {
      record(ctx, {
        path: [...suitePath(suite), "afterAll hook"],
        status: "fail",
        duration: 0,
        attempts: 1,
        errors: errs,
      });
    }
  }
}

/**
 * Run every test currently registered (i.e. whatever has been collected since
 * the last `resetRegistry()`), then reset the registry.
 */
export async function run(options: RunOptions & { file?: string } = {}): Promise<TestResult[]> {
  const ctx: Ctx = {
    opts: { timeout: DEFAULT_TIMEOUT, retries: 0, ...options },
    file: options.file,
    onlyMode: hasOnly(),
    results: [],
    bailed: false,
  };

  process.on("unhandledRejection", onStray);
  process.on("uncaughtException", onStray);
  try {
    for (const err of stray.splice(0)) {
      record(ctx, { path: ["(error outside of a test)"], status: "fail", duration: 0, attempts: 0, errors: [err] });
    }
    await runSuite(getRoot(), ctx);
  } finally {
    process.off("unhandledRejection", onStray);
    process.off("uncaughtException", onStray);
    resetRegistry();
  }
  return ctx.results;
}
