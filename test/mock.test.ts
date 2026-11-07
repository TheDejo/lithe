import { describe, test, expect, fn, spyOn } from "../src";

describe("fn()", () => {
  test("records calls and results", () => {
    const add = fn((a: number, b: number) => a + b);
    expect(add(1, 2)).toBe(3);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(1, 2);
    expect(add.mock.results[0]).toEqual({ type: "return", value: 3 });
  });

  test("once-implementations take priority, then fall back", () => {
    const f = fn(() => "default").mockReturnValueOnce("first");
    expect(f()).toBe("first");
    expect(f()).toBe("default");
  });

  test("resolved / rejected values", async () => {
    const f = fn<() => Promise<string>>().mockResolvedValueOnce("ok").mockRejectedValueOnce(new Error("boom"));
    await expect(f()).resolves.toBe("ok");
    await expect(f()).rejects.toThrow("boom");
  });

  test("mockReset clears calls and implementations", () => {
    const f = fn(() => 1);
    f();
    f.mockReset();
    expect(f).not.toHaveBeenCalled();
    expect(f()).toBeUndefined();
  });
});

describe("spyOn()", () => {
  test("calls through, records, and restores", () => {
    const client = { greet: (name: string) => `hi ${name}` };
    const original = client.greet;
    const spy = spyOn(client, "greet");

    expect(client.greet("ada")).toBe("hi ada");
    expect(spy).toHaveBeenLastCalledWith("ada");

    spy.mockReturnValue("mocked");
    expect(client.greet("ada")).toBe("mocked");

    spy.mockRestore();
    expect(client.greet).toBe(original);
  });
});
