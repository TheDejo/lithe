import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { basename, dirname, join } from "path";
import { recordCall } from "./trace";

/**
 * Record and replay.
 *
 * Wrap a function that talks to a model or an API with `recorded(name, fn)`.
 *  - By default, calls are replayed from `__recordings__/<test file>.json`
 *    next to the test file. A call with no recording fails the test.
 *  - `lithe --record` calls through for anything not yet recorded and saves it.
 *  - `lithe --rerecord` calls through for everything and replaces what the
 *    tests that ran had recorded.
 */
export type RecordingMode = "replay" | "record" | "rerecord";

export interface RecordingEntry {
  call: string;
  key: string;
  args: unknown[];
  result?: unknown;
  error?: { name: string; message: string };
}

interface RecordingFile {
  version: 1;
  tests: Record<string, RecordingEntry[]>;
}

interface TestContext {
  file?: string;
  path: string[];
}

interface State {
  mode: RecordingMode;
  current?: TestContext;
  /** Entries already replayed in the current test attempt. */
  used: Set<RecordingEntry>;
  /** Entries recorded in the current test attempt (rerecord starts empty). */
  fresh: RecordingEntry[];
  files: Map<string, { data: RecordingFile; dirty: boolean }>;
}

const KEY = Symbol.for("lithe.recordings");

function state(): State {
  const g = globalThis as any;
  return (g[KEY] ??= { mode: "replay", used: new Set(), fresh: [], files: new Map() } satisfies State);
}

export function setRecordingMode(mode: RecordingMode): void {
  state().mode = mode;
}

export function getRecordingMode(): RecordingMode {
  return state().mode;
}

export function recordingPath(testFile: string): string {
  return join(dirname(testFile), "__recordings__", `${basename(testFile)}.json`);
}

function load(testFile: string) {
  const s = state();
  let f = s.files.get(testFile);
  if (!f) {
    const path = recordingPath(testFile);
    let data: RecordingFile = { version: 1, tests: {} };
    if (existsSync(path)) {
      try {
        const parsed = JSON.parse(readFileSync(path, "utf8"));
        if (parsed && parsed.version === 1 && parsed.tests) data = parsed;
      } catch (e) {
        throw new Error(`Could not read recordings at ${path}: ${(e as Error).message}`);
      }
    }
    f = { data, dirty: false };
    s.files.set(testFile, f);
  }
  return f;
}

/** Called by the runner before each test attempt. */
export function beginRecordingTest(file: string | undefined, path: string[]): void {
  const s = state();
  s.current = { file, path };
  s.used = new Set();
  s.fresh = [];
}

/** Called by the runner after each test attempt; `passed` keeps failed attempts from overwriting good recordings. */
export function endRecordingTest(passed: boolean): void {
  const s = state();
  const ctx = s.current;
  s.current = undefined;
  if (!ctx?.file || !s.fresh.length) return;
  if (s.mode === "replay") return;
  const f = load(ctx.file);
  const id = ctx.path.join(" > ");
  if (s.mode === "rerecord") {
    if (!passed && f.data.tests[id]?.length) return;
    f.data.tests[id] = s.fresh;
  } else {
    f.data.tests[id] = [...(f.data.tests[id] ?? []), ...s.fresh];
  }
  f.dirty = true;
}

/** Write any changed recording files. Called by the CLI after each test file. */
export function saveRecordings(): string[] {
  const written: string[] = [];
  for (const [testFile, f] of state().files) {
    if (!f.dirty) continue;
    const path = recordingPath(testFile);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(f.data, null, 2) + "\n");
    f.dirty = false;
    written.push(path);
  }
  return written;
}

/** Forget loaded files (between runs, e.g. in tests of Lithe itself). */
export function resetRecordings(): void {
  state().files.clear();
}

/** JSON with sorted keys, so the same arguments always produce the same key. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]));
    }
    if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
    if (typeof v === "bigint") return `${v}n`;
    if (v === undefined) return null;
    return v;
  }) ?? "null";
}

function clone<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function describeCall(name: string, args: unknown[]): string {
  const s = stable(args).slice(1, -1);
  return `${name}(${s.length > 120 ? s.slice(0, 119) + "…" : s})`;
}

/**
 * Wrap an async function so its calls are recorded once and replayed after.
 *
 *   const llm = recorded("llm", (params) => client.messages.create(params));
 *
 * Arguments and results must be JSON-serialisable. Outside a running test the
 * wrapper simply calls through.
 */
export function recorded<F extends (...args: any[]) => any>(
  name: string,
  fn: F
): (...args: Parameters<F>) => Promise<Awaited<ReturnType<F>>> {
  const wrapper = async function (this: unknown, ...args: Parameters<F>) {
    const s = state();
    const ctx = s.current;
    if (!ctx?.file) return fn.apply(this, args);

    return recordCall(name, args, async () => {
      const argsJson = stable(args);
      const key = createHash("sha1").update(`${name}\n${argsJson}`).digest("hex").slice(0, 16);
      const id = ctx.path.join(" > ");

      if (s.mode !== "rerecord") {
        const existing = load(ctx.file!).data.tests[id] ?? [];
        const hit = existing.find((e) => e.call === name && e.key === key && !s.used.has(e));
        if (hit) {
          s.used.add(hit);
          if (hit.error) {
            const err = new Error(hit.error.message);
            err.name = hit.error.name;
            throw err;
          }
          return clone(hit.result);
        }
        if (s.mode === "replay") {
          throw new Error(
            `No recording for ${describeCall(name, args)} in test "${id}".\n` +
              "Run once with --record to call it for real and save the response."
          );
        }
      }

      const entry: RecordingEntry = { call: name, key, args: JSON.parse(argsJson) };
      try {
        const result = await fn.apply(this, args);
        entry.result = clone(result);
        s.fresh.push(entry);
        return result;
      } catch (e) {
        entry.error = { name: (e as Error)?.name ?? "Error", message: (e as Error)?.message ?? String(e) };
        s.fresh.push(entry);
        throw e;
      }
    }) as Promise<Awaited<ReturnType<F>>>;
  };
  Object.defineProperty(wrapper, "name", { value: name });
  return wrapper;
}
