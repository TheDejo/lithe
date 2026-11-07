import { inspect } from "util";

/**
 * One step in a test's trace. Traces answer "what did the agent actually do,
 * and why?" when a test fails or its behaviour changes between runs.
 */
export interface TraceEvent {
  /** "call" = a traced function / named mock was invoked; "note" = recorded by the test or agent. */
  type: "call" | "note";
  /** Function name for calls, the message for notes. */
  name: string;
  /** Milliseconds since the test started. */
  at: number;
  /** Call duration in ms. */
  duration?: number;
  /** Call arguments. */
  input?: unknown[];
  /** Call return value (awaited if it was a promise). */
  output?: unknown;
  /** Error message if the call threw / rejected. */
  error?: string;
  /** Extra structured data attached to a note. */
  data?: unknown;
}

interface TraceState {
  events?: TraceEvent[];
  start: number;
}

const KEY = Symbol.for("lithe.trace");

function state(): TraceState {
  const g = globalThis as any;
  return (g[KEY] ??= { events: undefined, start: 0 });
}

/** Start recording a new trace (called by the runner for each test attempt). */
export function beginTrace(): void {
  const s = state();
  s.events = [];
  s.start = performance.now();
}

/** Stop recording and return what was captured. */
export function endTrace(): TraceEvent[] {
  const s = state();
  const events = s.events ?? [];
  s.events = undefined;
  return events;
}

function push(event: Omit<TraceEvent, "at">, at = performance.now()): void {
  const s = state();
  if (!s.events) return; // not inside a test: tracing is a no-op
  s.events.push({ at: Math.round(at - s.start), ...event });
  // Calls are pushed when they finish; keep the trace in start order.
  s.events.sort((a, b) => a.at - b.at);
}

const MAX_STRING = 4000;
const MAX_DEPTH = 8;

/** Make a value safe to store as JSON: no cycles, no functions, bounded size. */
export function snapshot(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return value.length > MAX_STRING ? value.slice(0, MAX_STRING) + `… [${value.length - MAX_STRING} more chars]` : value;
  }
  if (value === undefined) return undefined;
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (typeof value === "symbol") return value.toString();
  if (value instanceof Error) return { error: value.name, message: value.message };
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return inspect(value, { depth: 0 });
  seen.add(value);
  if (Array.isArray(value)) return value.map((v) => snapshot(v, depth + 1, seen));
  if (value instanceof Map) return { "[Map]": [...value].map(([k, v]) => [snapshot(k, depth + 1, seen), snapshot(v, depth + 1, seen)]) };
  if (value instanceof Set) return { "[Set]": [...value].map((v) => snapshot(v, depth + 1, seen)) };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = snapshot(v, depth + 1, seen);
  return out;
}

/** Run `invoke` and record it as a call to `name` in the current trace. */
export function recordCall(name: string, args: unknown[], invoke: () => unknown): unknown {
  if (!state().events) return invoke();
  const started = performance.now();
  const input = snapshot(args) as unknown[];
  const finish = (fields: Partial<TraceEvent>) =>
    push({ type: "call", name, input, duration: Math.round(performance.now() - started), ...fields }, started);

  let result: unknown;
  try {
    result = invoke();
  } catch (e) {
    finish({ error: (e as Error)?.message ?? String(e) });
    throw e;
  }
  if (result && typeof (result as Promise<unknown>).then === "function") {
    // Record once the promise settles, but hand back the original promise untouched.
    (result as Promise<unknown>).then(
      (v) => finish({ output: snapshot(v) }),
      (e) => finish({ error: (e as Error)?.message ?? String(e) })
    );
    return result;
  }
  finish({ output: snapshot(result) });
  return result;
}

/**
 * Record why something happened: a decision, an intermediate result, the
 * prompt that was sent. Shows up in the test's trace, in failure output and
 * in `--report` files. Does nothing outside of a running test, so it is safe
 * to call from agent code.
 */
export function note(message: string, data?: unknown): void {
  push({ type: "note", name: message, data: data === undefined ? undefined : snapshot(data) });
}

/**
 * Wrap a function (an LLM client, a tool, ...) so every call is recorded in
 * the current test's trace with its arguments, result and duration.
 *
 *   const llm = traced("llm", (messages) => client.messages.create(...));
 */
export function traced<F extends (...args: any[]) => any>(name: string, fn: F): F {
  const wrapper = function (this: unknown, ...args: any[]) {
    return recordCall(name, args, () => fn.apply(this, args));
  };
  Object.defineProperty(wrapper, "name", { value: name });
  return wrapper as F;
}
