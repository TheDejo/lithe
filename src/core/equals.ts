export abstract class AsymmetricMatcher {
  abstract asymmetricMatch(other: unknown): boolean;
  abstract toString(): string;
  // Shown by util.inspect in failure messages.
  [Symbol.for("nodejs.util.inspect.custom")]() {
    return this.toString();
  }
}

export function isAsymmetric(value: unknown): value is AsymmetricMatcher {
  return value instanceof AsymmetricMatcher ||
    (!!value && typeof (value as any).asymmetricMatch === "function");
}

/**
 * Recursive structural equality. `partial` makes object comparison only check
 * keys present on `b` (used by toMatchObject / objectContaining).
 */
export function equals(a: unknown, b: unknown, partial = false, seen = new WeakMap<object, object>()): boolean {
  if (isAsymmetric(b)) return b.asymmetricMatch(a);
  if (isAsymmetric(a)) return a.asymmetricMatch(b);
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;

  if (seen.get(a) === b) return true;
  seen.set(a, b);

  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp && b instanceof RegExp) return a.toString() === b.toString();
  if (a instanceof Error && b instanceof Error) {
    return a.name === b.name && a.message === b.message;
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => equals(v, b[i], partial, seen));
  }

  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) {
      if (!b.has(k) || !equals(v, b.get(k), partial, seen)) return false;
    }
    return true;
  }

  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) {
      if (![...b].some((w) => equals(v, w, partial, seen))) return false;
    }
    return true;
  }

  if (!partial && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  // Keys whose value is undefined are treated as absent (same as Jest's toEqual).
  const definedKeys = (o: Record<string, unknown>) => Object.keys(o).filter((k) => o[k] !== undefined);
  const keysB = definedKeys(objB);
  if (!partial && definedKeys(objA).length !== keysB.length) return false;
  return keysB.every((k) => k in objA && equals(objA[k], objB[k], partial, seen));
}

// ---------------------------------------------------------------------------
// Asymmetric matchers: expect.any(), expect.stringContaining(), ...
// ---------------------------------------------------------------------------

class Any extends AsymmetricMatcher {
  constructor(private ctor: any) {
    super();
  }
  asymmetricMatch(other: unknown) {
    const c = this.ctor;
    if (c === String) return typeof other === "string" || other instanceof String;
    if (c === Number) return typeof other === "number" || other instanceof Number;
    if (c === Boolean) return typeof other === "boolean" || other instanceof Boolean;
    if (c === Function) return typeof other === "function";
    if (c === Object) return typeof other === "object" && other !== null;
    if (c === BigInt) return typeof other === "bigint";
    if (c === Symbol) return typeof other === "symbol";
    return other instanceof c;
  }
  toString() {
    return `Any<${this.ctor?.name ?? "unknown"}>`;
  }
}

class Anything extends AsymmetricMatcher {
  asymmetricMatch(other: unknown) {
    return other !== null && other !== undefined;
  }
  toString() {
    return "Anything";
  }
}

class StringContaining extends AsymmetricMatcher {
  constructor(private sub: string, private ignoreCase: boolean) {
    super();
  }
  asymmetricMatch(other: unknown) {
    if (typeof other !== "string") return false;
    return this.ignoreCase
      ? other.toLowerCase().includes(this.sub.toLowerCase())
      : other.includes(this.sub);
  }
  toString() {
    return `StringContaining(${JSON.stringify(this.sub)}${this.ignoreCase ? ", ignoreCase" : ""})`;
  }
}

class StringMatching extends AsymmetricMatcher {
  private re: RegExp;
  constructor(pattern: string | RegExp) {
    super();
    this.re = typeof pattern === "string" ? new RegExp(pattern) : pattern;
  }
  asymmetricMatch(other: unknown) {
    return typeof other === "string" && this.re.test(other);
  }
  toString() {
    return `StringMatching(${this.re})`;
  }
}

class ObjectContaining extends AsymmetricMatcher {
  constructor(private sample: object) {
    super();
  }
  asymmetricMatch(other: unknown) {
    return typeof other === "object" && other !== null && equals(other, this.sample, true);
  }
  toString() {
    return `ObjectContaining(${JSON.stringify(this.sample)})`;
  }
}

class ArrayContaining extends AsymmetricMatcher {
  constructor(private sample: unknown[]) {
    super();
  }
  asymmetricMatch(other: unknown) {
    return Array.isArray(other) && this.sample.every((s) => other.some((o) => equals(o, s)));
  }
  toString() {
    return `ArrayContaining(${JSON.stringify(this.sample)})`;
  }
}

class OneOf extends AsymmetricMatcher {
  constructor(private options: unknown[]) {
    super();
  }
  asymmetricMatch(other: unknown) {
    return this.options.some((o) => equals(other, o));
  }
  toString() {
    return `OneOf(${JSON.stringify(this.options)})`;
  }
}

class Satisfies extends AsymmetricMatcher {
  constructor(private predicate: (v: any) => boolean, private label: string) {
    super();
  }
  asymmetricMatch(other: unknown) {
    try {
      return !!this.predicate(other);
    } catch {
      return false;
    }
  }
  toString() {
    return `Satisfies(${this.label})`;
  }
}

export const asymmetric = {
  any: (ctor: unknown) => new Any(ctor),
  anything: () => new Anything(),
  stringContaining: (sub: string, opts: { ignoreCase?: boolean } = {}) =>
    new StringContaining(sub, !!opts.ignoreCase),
  stringMatching: (pattern: string | RegExp) => new StringMatching(pattern),
  objectContaining: (sample: object) => new ObjectContaining(sample),
  arrayContaining: (sample: unknown[]) => new ArrayContaining(sample),
  oneOf: (options: unknown[]) => new OneOf(options),
  satisfies: (predicate: (v: any) => boolean, label = predicate.name || "predicate") =>
    new Satisfies(predicate, label),
};
