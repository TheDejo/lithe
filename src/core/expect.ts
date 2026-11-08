import { inspect } from "util";
import { asymmetric, equals } from "./equals";
import { isMock } from "./mock";
import { judge, meaningCriterion, similarity, trackAssertion } from "./semantic";

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

export const fmt = (v: unknown) =>
  inspect(v, { depth: 6, breakLength: 100, maxArrayLength: 50, maxStringLength: 2000 });

interface MatcherResult {
  pass: boolean;
  /** Message used when the assertion fails. Gets `isNot` so it can phrase "not". */
  message: (isNot: boolean) => string;
}

type Matcher = (received: any, ...args: any[]) => MatcherResult | Promise<MatcherResult>;

const not = (isNot: boolean) => (isNot ? "not " : "");
const dotNot = (isNot: boolean) => (isNot ? "not." : "");

function simple(name: string, pass: boolean, expected: unknown, received: unknown, hasExpected = true): MatcherResult {
  return {
    pass,
    message: (isNot) =>
      `expect(received).${dotNot(isNot)}${name}(${hasExpected ? "expected" : ""})\n\n` +
      (hasExpected ? `Expected: ${not(isNot)}${fmt(expected)}\n` : "") +
      `Received: ${fmt(received)}`,
  };
}

function lengthOf(v: any): number | undefined {
  return v != null && typeof v.length === "number" ? v.length : undefined;
}

function contains(received: any, item: any, deep: boolean): boolean {
  if (typeof received === "string") return typeof item === "string" && received.includes(item);
  if (received == null || typeof received[Symbol.iterator] !== "function") {
    throw new AssertionError(`toContain: received value must be a string or iterable, got ${fmt(received)}`);
  }
  for (const v of received) if (deep ? equals(v, item) : v === item) return true;
  return false;
}

function getPath(obj: any, path: string | (string | number)[]): { found: boolean; value: unknown } {
  const parts = Array.isArray(path) ? path : path.replace(/\[(\w+)\]/g, ".$1").split(".").filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || !(Object(cur) instanceof Object) || !(p in Object(cur))) return { found: false, value: undefined };
    cur = cur[p as any];
  }
  return { found: true, value: cur };
}

function requireMock(received: unknown, name: string) {
  if (!isMock(received)) throw new AssertionError(`${name}: received value must be a mock created with fn() or spyOn()`);
  return received;
}

const matchers: Record<string, Matcher> = {
  toBe: (r, e) => simple("toBe", Object.is(r, e), e, r),
  toEqual: (r, e) => simple("toEqual", equals(r, e), e, r),
  toMatchObject: (r, e) => simple("toMatchObject", typeof r === "object" && r !== null && equals(r, e, true), e, r),
  toBeDefined: (r) => simple("toBeDefined", r !== undefined, undefined, r, false),
  toBeUndefined: (r) => simple("toBeUndefined", r === undefined, undefined, r, false),
  toBeNull: (r) => simple("toBeNull", r === null, undefined, r, false),
  toBeTruthy: (r) => simple("toBeTruthy", !!r, undefined, r, false),
  toBeFalsy: (r) => simple("toBeFalsy", !r, undefined, r, false),
  toBeNaN: (r) => simple("toBeNaN", Number.isNaN(r), undefined, r, false),
  toBeInstanceOf: (r, C) => simple("toBeInstanceOf", r instanceof C, C?.name, r),
  toBeTypeOf: (r, t) => simple("toBeTypeOf", typeof r === t, t, typeof r),
  toBeGreaterThan: (r, n) => simple("toBeGreaterThan", r > n, n, r),
  toBeGreaterThanOrEqual: (r, n) => simple("toBeGreaterThanOrEqual", r >= n, n, r),
  toBeLessThan: (r, n) => simple("toBeLessThan", r < n, n, r),
  toBeLessThanOrEqual: (r, n) => simple("toBeLessThanOrEqual", r <= n, n, r),
  toBeCloseTo: (r, n, digits = 2) =>
    simple("toBeCloseTo", Math.abs(r - n) < Math.pow(10, -digits) / 2, n, r),
  toContain: (r, item) => simple("toContain", contains(r, item, false), item, r),
  toContainEqual: (r, item) => simple("toContainEqual", contains(r, item, true), item, r),
  toHaveLength: (r, n) => simple("toHaveLength", lengthOf(r) === n, n, lengthOf(r)),
  toMatch: (r, pattern: string | RegExp) =>
    simple(
      "toMatch",
      typeof r === "string" && (typeof pattern === "string" ? r.includes(pattern) : pattern.test(r)),
      pattern,
      r
    ),
  toHaveProperty(r, path, ...rest) {
    const { found, value } = getPath(r, path);
    const checkValue = rest.length > 0;
    const pass = found && (!checkValue || equals(value, rest[0]));
    return {
      pass,
      message: (isNot) =>
        `expect(received).${dotNot(isNot)}toHaveProperty(${fmt(path)}${checkValue ? ", value" : ""})\n\n` +
        (checkValue ? `Expected value: ${not(isNot)}${fmt(rest[0])}\n` : "") +
        (found ? `Received value: ${fmt(value)}` : `Property not found on: ${fmt(r)}`),
    };
  },
  toThrow(r, expected?: string | RegExp | (new (...a: any[]) => Error) | Error) {
    if (typeof r !== "function") throw new AssertionError("toThrow: received value must be a function");
    let threw = false;
    let error: any;
    try {
      r();
    } catch (e) {
      threw = true;
      error = e;
    }
    return throwResult(threw, error, expected);
  },

  // --- AI-friendly matchers ------------------------------------------------
  /** Value deep-equals one of several acceptable answers. */
  toBeOneOf: (r, options: unknown[]) => simple("toBeOneOf", options.some((o) => equals(r, o)), options, r),
  /** String or array contains at least one of the items (strings: case-insensitive substring). */
  toContainAny: (r, items: unknown[]) => simple("toContainAny", items.some((i) => containsLoose(r, i)), items, r),
  /** String or array contains every one of the items (strings: case-insensitive substring). */
  toContainAll(r, items: unknown[]) {
    const missing = items.filter((i) => !containsLoose(r, i));
    return {
      pass: missing.length === 0,
      message: (isNot) =>
        `expect(received).${dotNot(isNot)}toContainAll(expected)\n\n` +
        `Expected: ${not(isNot)}${fmt(items)}\n` +
        (isNot ? "" : `Missing:  ${fmt(missing)}\n`) +
        `Received: ${fmt(r)}`,
    };
  },
  /** String parses as JSON (optionally matching a partial shape). */
  toBeJSON(r, shape?: unknown) {
    let parsed: unknown;
    let ok = typeof r === "string";
    if (ok) {
      try {
        parsed = JSON.parse(r);
      } catch {
        ok = false;
      }
    }
    const pass = ok && (shape === undefined || equals(parsed, shape, true));
    return {
      pass,
      message: (isNot) =>
        `expect(received).${dotNot(isNot)}toBeJSON(${shape === undefined ? "" : "shape"})\n\n` +
        (shape === undefined ? "" : `Expected shape: ${fmt(shape)}\n`) +
        `Received: ${fmt(ok ? parsed : r)}`,
    };
  },
  /** Custom predicate, for anything the built-ins don't cover. */
  toSatisfy(r, predicate: (v: any) => boolean, description?: string) {
    let pass = false;
    let err: unknown;
    try {
      pass = !!predicate(r);
    } catch (e) {
      err = e;
    }
    const label = description ?? (predicate.name || "predicate");
    return {
      pass,
      message: (isNot) =>
        `expect(received).${dotNot(isNot)}toSatisfy(${label})\n\n` +
        `Received: ${fmt(r)}` +
        (err ? `\nPredicate threw: ${(err as Error)?.message ?? err}` : ""),
    };
  },

  // --- semantic matchers (async: always await them) ------------------------
  /** An LLM judge decides whether the value means the same as the reference. */
  async toMean(r, reference: string) {
    const v = await judge(r, [meaningCriterion(reference)], "toMean");
    return {
      pass: v.pass,
      message: (isNot) =>
        `expect(received).${dotNot(isNot)}toMean(reference)\n\n` +
        `Reference: ${not(isNot)}${fmt(reference)}\n` +
        `Received:  ${fmt(r)}\n\n` +
        `Judge: ${v.reason || (v.pass ? "means the same" : "does not mean the same")}`,
    };
  },
  /** An LLM judge checks the value against every criterion. */
  async toMeetCriteria(r, criteria: string | string[]) {
    const list = Array.isArray(criteria) ? criteria : [criteria];
    const v = await judge(r, list, "toMeetCriteria");
    return {
      pass: v.pass,
      message: (isNot) =>
        `expect(received).${dotNot(isNot)}toMeetCriteria(criteria)\n\n` +
        `Criteria: ${not(isNot)}${list.map((c) => `\n  - ${c}`).join("")}\n` +
        `Received: ${fmt(r)}\n\n` +
        `Judge: ${v.reason || (v.pass ? "meets the criteria" : "does not meet the criteria")}`,
    };
  },
  /** Cosine similarity of embeddings is at least `threshold` (default 0.8). */
  async toBeSimilarTo(r, expected: string, options: { threshold?: number } = {}) {
    const threshold = options.threshold ?? 0.8;
    const score = await similarity(r, expected);
    return {
      pass: score >= threshold,
      message: (isNot) =>
        `expect(received).${dotNot(isNot)}toBeSimilarTo(expected, { threshold: ${threshold} })\n\n` +
        `Expected: ${not(isNot)}${fmt(expected)}\n` +
        `Received: ${fmt(r)}\n\n` +
        `Similarity: ${score.toFixed(3)} (threshold ${threshold})`,
    };
  },

  // --- mock matchers -------------------------------------------------------
  toHaveBeenCalled(r) {
    const m = requireMock(r, "toHaveBeenCalled");
    return simple("toHaveBeenCalled", m.mock.calls.length > 0, undefined, `${m.mock.calls.length} call(s)`, false);
  },
  toHaveBeenCalledTimes(r, n: number) {
    const m = requireMock(r, "toHaveBeenCalledTimes");
    return simple("toHaveBeenCalledTimes", m.mock.calls.length === n, n, m.mock.calls.length);
  },
  toHaveBeenCalledWith(r, ...args: unknown[]) {
    const m = requireMock(r, "toHaveBeenCalledWith");
    return {
      pass: m.mock.calls.some((c) => equals(c, args)),
      message: (isNot) =>
        `expect(mock).${dotNot(isNot)}toHaveBeenCalledWith(...expected)\n\n` +
        `Expected: ${not(isNot)}${fmt(args)}\n` +
        `Calls:    ${m.mock.calls.length ? m.mock.calls.map(fmt).join("\n          ") : "(none)"}`,
    };
  },
  toHaveBeenLastCalledWith(r, ...args: unknown[]) {
    const m = requireMock(r, "toHaveBeenLastCalledWith");
    const last = m.mock.calls[m.mock.calls.length - 1];
    return simple("toHaveBeenLastCalledWith", !!last && equals(last, args), args, last ?? "(no calls)");
  },
};

function containsLoose(received: unknown, item: unknown): boolean {
  if (typeof received === "string") {
    return typeof item === "string" && received.toLowerCase().includes(item.toLowerCase());
  }
  if (Array.isArray(received)) return received.some((v) => equals(v, item));
  return false;
}

function throwResult(threw: boolean, error: any, expected: unknown): MatcherResult {
  let pass = threw;
  if (threw && expected !== undefined) {
    const msg = error?.message ?? String(error);
    if (typeof expected === "string") pass = msg.includes(expected);
    else if (expected instanceof RegExp) pass = expected.test(msg);
    else if (expected instanceof Error) pass = msg === expected.message;
    else if (typeof expected === "function") pass = error instanceof (expected as any);
  }
  return {
    pass,
    message: (isNot) =>
      `expect(fn).${dotNot(isNot)}toThrow(${expected === undefined ? "" : "expected"})\n\n` +
      (expected === undefined ? "" : `Expected: ${not(isNot)}${fmt(expected)}\n`) +
      (threw ? `Thrown:   ${fmt(error?.message ?? error)}` : "Function did not throw"),
  };
}

// ---------------------------------------------------------------------------

type MatcherName = keyof typeof matchers;

export interface Matchers<R = void> {
  toBe(expected: unknown): R;
  toEqual(expected: unknown): R;
  toMatchObject(expected: object): R;
  toBeDefined(): R;
  toBeUndefined(): R;
  toBeNull(): R;
  toBeTruthy(): R;
  toBeFalsy(): R;
  toBeNaN(): R;
  toBeInstanceOf(ctor: Function): R;
  toBeTypeOf(type: "string" | "number" | "boolean" | "object" | "function" | "undefined" | "bigint" | "symbol"): R;
  toBeGreaterThan(n: number | bigint): R;
  toBeGreaterThanOrEqual(n: number | bigint): R;
  toBeLessThan(n: number | bigint): R;
  toBeLessThanOrEqual(n: number | bigint): R;
  toBeCloseTo(n: number, digits?: number): R;
  toContain(item: unknown): R;
  toContainEqual(item: unknown): R;
  toHaveLength(n: number): R;
  toMatch(pattern: string | RegExp): R;
  toHaveProperty(path: string | (string | number)[], value?: unknown): R;
  toThrow(expected?: string | RegExp | Error | (new (...args: any[]) => Error)): R;
  toBeOneOf(options: unknown[]): R;
  toContainAny(items: unknown[]): R;
  toContainAll(items: unknown[]): R;
  toBeJSON(shape?: unknown): R;
  toSatisfy(predicate: (value: any) => boolean, description?: string): R;
  /** LLM-judged: means the same as the reference. Returns a promise: always `await` it. */
  toMean(reference: string): Promise<void>;
  /** LLM-judged: meets every criterion. Returns a promise: always `await` it. */
  toMeetCriteria(criteria: string | string[]): Promise<void>;
  /** Embedding similarity is at least `threshold` (default 0.8). Returns a promise: always `await` it. */
  toBeSimilarTo(expected: string, options?: { threshold?: number }): Promise<void>;
  toHaveBeenCalled(): R;
  toHaveBeenCalledTimes(n: number): R;
  toHaveBeenCalledWith(...args: unknown[]): R;
  toHaveBeenLastCalledWith(...args: unknown[]): R;
}

export interface Assertion extends Matchers<void> {
  not: Matchers<void>;
  /** Unwrap a promise, then assert on its resolved value. */
  resolves: Matchers<Promise<void>> & { not: Matchers<Promise<void>> };
  /** Expect a promise to reject, then assert on the rejection reason. */
  rejects: Matchers<Promise<void>> & { not: Matchers<Promise<void>> };
}

function build(received: unknown, isNot: boolean): Matchers<void> {
  const out: any = {};
  for (const name of Object.keys(matchers) as MatcherName[]) {
    out[name] = (...args: unknown[]) => {
      // Created now so the stack points at the test, even for async matchers.
      const err = new AssertionError("");
      Error.captureStackTrace?.(err, out[name]);
      const check = (result: MatcherResult) => {
        if (result.pass === isNot) {
          err.message = result.message(isNot);
          throw err;
        }
      };
      const result = matchers[name](received, ...args);
      if (result && typeof (result as Promise<MatcherResult>).then === "function") {
        return trackAssertion((result as Promise<MatcherResult>).then(check));
      }
      check(result as MatcherResult);
    };
  }
  return out;
}

function buildAsync(promise: unknown, mode: "resolves" | "rejects", isNot: boolean): Matchers<Promise<void>> {
  const out: any = {};
  for (const name of Object.keys(matchers) as MatcherName[]) {
    out[name] = (...args: unknown[]) => trackAssertion(run(name, args));
  }
  async function run(name: MatcherName, args: unknown[]): Promise<void> {
    {
      if (!promise || typeof (promise as any).then !== "function") {
        throw new AssertionError(`expect(received).${mode}: received value must be a promise`);
      }
      let value: unknown;
      if (mode === "resolves") {
        try {
          value = await promise;
        } catch (e) {
          throw new AssertionError(`expect(received).resolves.${name}(): promise rejected with ${fmt(e)}`);
        }
      } else {
        try {
          await promise;
        } catch (e) {
          value = e;
          // Let toThrow work against the rejection reason.
          if (name === "toThrow") {
            const r = throwResult(true, e, args[0]);
            if (r.pass === isNot) throw new AssertionError(r.message(isNot));
            return;
          }
          return await (build(value, isNot) as any)[name](...args);
        }
        throw new AssertionError(`expect(received).rejects.${name}(): promise resolved instead of rejecting`);
      }
      return await (build(value, isNot) as any)[name](...args);
    }
  }
  return out;
}

export interface Expect {
  (received: unknown): Assertion;
  any: typeof asymmetric.any;
  anything: typeof asymmetric.anything;
  stringContaining: typeof asymmetric.stringContaining;
  stringMatching: typeof asymmetric.stringMatching;
  objectContaining: typeof asymmetric.objectContaining;
  arrayContaining: typeof asymmetric.arrayContaining;
  oneOf: typeof asymmetric.oneOf;
  satisfies: typeof asymmetric.satisfies;
}

export const expect: Expect = Object.assign(
  (received: unknown): Assertion => {
    const a: any = build(received, false);
    a.not = build(received, true);
    a.resolves = Object.assign(buildAsync(received, "resolves", false), {
      not: buildAsync(received, "resolves", true),
    });
    a.rejects = Object.assign(buildAsync(received, "rejects", false), {
      not: buildAsync(received, "rejects", true),
    });
    return a;
  },
  asymmetric
);
