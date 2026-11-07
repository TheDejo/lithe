import { describe, test, expect, AssertionError } from "../src";

function fails(fn: () => void, messagePart?: string) {
  try {
    fn();
  } catch (e) {
    if (!(e instanceof AssertionError)) throw e;
    if (messagePart && !e.message.includes(messagePart)) {
      throw new Error(`Expected failure message to include ${JSON.stringify(messagePart)}, got:\n${e.message}`);
    }
    return;
  }
  throw new Error("Expected assertion to fail, but it passed");
}

describe("equality", () => {
  test("toBe uses Object.is", () => {
    expect(1).toBe(1);
    expect(NaN).toBe(NaN);
    fails(() => expect({}).toBe({}));
    fails(() => expect(1).toBe(2), "Expected: 2");
  });

  test("toEqual compares deeply", () => {
    expect({ a: [1, { b: 2 }], c: new Date(0) }).toEqual({ a: [1, { b: 2 }], c: new Date(0) });
    expect(new Map([["k", [1]]])).toEqual(new Map([["k", [1]]]));
    expect(new Set([1, 2])).toEqual(new Set([2, 1]));
    expect({ a: 1, b: undefined }).toEqual({ a: 1 });
    fails(() => expect({ a: 1 }).toEqual({ a: 1, b: 2 }));
    fails(() => expect([1, 2]).toEqual([1, 2, 3]));
  });

  test("toMatchObject checks a subset", () => {
    expect({ a: 1, b: { c: 2, d: 3 } }).toMatchObject({ b: { c: 2 } });
    fails(() => expect({ a: 1 }).toMatchObject({ a: 2 }));
  });

  test(".not inverts", () => {
    expect(1).not.toBe(2);
    fails(() => expect(1).not.toBe(1), "not.toBe");
  });
});

describe("asymmetric matchers", () => {
  test("work inside toEqual", () => {
    expect({ id: "abc", n: 3, tags: ["x", "y"], at: new Date() }).toEqual({
      id: expect.stringMatching(/^[a-z]+$/),
      n: expect.any(Number),
      tags: expect.arrayContaining(["y"]),
      at: expect.anything(),
    });
  });

  test("stringContaining can ignore case", () => {
    expect("Hello World").toEqual(expect.stringContaining("WORLD", { ignoreCase: true }));
    fails(() => expect("Hello World").toEqual(expect.stringContaining("WORLD")));
  });

  test("oneOf and satisfies", () => {
    expect({ label: "positive" }).toEqual({ label: expect.oneOf(["positive", "neutral"]) });
    expect({ score: 0.8 }).toEqual({ score: expect.satisfies((n: number) => n > 0.5) });
    fails(() => expect({ score: 0.2 }).toEqual({ score: expect.satisfies((n: number) => n > 0.5) }));
  });
});

describe("collections and strings", () => {
  test("toContain / toContainEqual", () => {
    expect([1, 2, 3]).toContain(2);
    expect("frontend developer").toContain("front");
    expect([{ a: 1 }]).toContainEqual({ a: 1 });
    fails(() => expect([{ a: 1 }]).toContain({ a: 1 }));
  });

  test("toHaveLength / toMatch / toHaveProperty", () => {
    expect([1, 2]).toHaveLength(2);
    expect("abc123").toMatch(/\d+/);
    expect({ a: { b: [10, 20] } }).toHaveProperty("a.b[1]", 20);
    expect({ a: { b: [10, 20] } }).toHaveProperty(["a", "b"]);
    fails(() => expect({ a: {} }).toHaveProperty("a.b"), "Property not found");
  });

  test("toContainAny / toContainAll are case-insensitive for strings", () => {
    expect("The capital of France is Paris.").toContainAny(["paris", "lyon"]);
    expect("The capital of France is Paris.").toContainAll(["france", "PARIS"]);
    fails(() => expect("Paris").toContainAll(["paris", "berlin"]), "berlin");
    expect(["a", "b"]).toContainAny(["z", "b"]);
  });

  test("toBeOneOf", () => {
    expect("yes").toBeOneOf(["yes", "y"]);
    fails(() => expect("maybe").toBeOneOf(["yes", "no"]));
  });

  test("toBeJSON", () => {
    expect('{"ok":true,"items":[1]}').toBeJSON();
    expect('{"ok":true,"items":[1]}').toBeJSON({ ok: true });
    fails(() => expect("not json").toBeJSON());
    fails(() => expect('{"ok":false}').toBeJSON({ ok: true }));
  });
});

describe("numbers and types", () => {
  test("comparisons", () => {
    expect(5).toBeGreaterThan(4);
    expect(5).toBeLessThanOrEqual(5);
    expect(0.1 + 0.2).toBeCloseTo(0.3);
    fails(() => expect(0.1).toBeCloseTo(0.2));
  });

  test("truthiness and types", () => {
    expect(undefined).toBeUndefined();
    expect(null).toBeNull();
    expect(0).toBeFalsy();
    expect("x").toBeTruthy();
    expect("x").toBeDefined();
    expect("x").toBeTypeOf("string");
    expect(new RangeError("x")).toBeInstanceOf(Error);
  });

  test("toSatisfy", () => {
    expect(42).toSatisfy((n) => n % 2 === 0, "is even");
    fails(() => expect(41).toSatisfy((n) => n % 2 === 0, "is even"), "is even");
  });
});

describe("errors and promises", () => {
  test("toThrow", () => {
    expect(() => {
      throw new TypeError("bad input");
    }).toThrow("bad");
    expect(() => {
      throw new TypeError("bad input");
    }).toThrow(TypeError);
    expect(() => {}).not.toThrow();
    fails(() => expect(() => {}).toThrow(), "did not throw");
  });

  test("resolves / rejects", async () => {
    await expect(Promise.resolve({ a: 1 })).resolves.toEqual({ a: 1 });
    await expect(Promise.reject(new Error("nope"))).rejects.toThrow("nope");
    await expect(Promise.resolve(1)).resolves.not.toBe(2);

    let failed = false;
    await expect(Promise.resolve(1)).rejects.toThrow().catch(() => (failed = true));
    expect(failed).toBe(true);
  });
});
